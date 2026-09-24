import UIKit
import Capacitor
import Speech
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - Traductor por voz nativo
//
// José (24 sep 2026): el reconocimiento de voz del WKWebView
// (webkitSpeechRecognition) no es fiable dentro de una app y daba "Permiso de
// micrófono denegado" sin llegar a pedirlo. El traductor por voz es una
// funcionalidad vital, así que se hace nativo: SFSpeechRecognizer para
// escuchar y AVSpeechSynthesizer para leer la traducción.
//
// Va en este archivo (y no en uno nuevo) a propósito: así no hay que tocar el
// project.pbxproj de Xcode para que se compile. Mismo API que el plugin de
// Android (android/.../KaikodoSpeechPlugin.java):
//  - requestAccess()        -> { granted, available }
//  - start({ lang })        -> emite 'result' { text } con todo lo dicho
//  - stop()                 -> { text } final
//  - speak({ text, lang, rate }) / stopSpeaking()
//  - evento 'error' { code }: 'not-allowed' | 'unavailable' | 'no-speech' | 'network' | 'error'


class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KaikodoSpeechPlugin())
    }
}

@objc(KaikodoSpeechPlugin)
public class KaikodoSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KaikodoSpeechPlugin"
    public let jsName = "KaikodoSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
    ]

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var lastText = ""
    private var active = false
    private let synth = AVSpeechSynthesizer()

    // ── Permisos ──────────────────────────────────────────────────────────────
    @objc func requestAccess(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.resolve(["granted": false, "available": true])
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { micOk in
                call.resolve(["granted": micOk, "available": true])
            }
        }
    }

    // ── Reconocimiento ────────────────────────────────────────────────────────
    @objc func start(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "es-ES"
        DispatchQueue.main.async {
            guard SFSpeechRecognizer.authorizationStatus() == .authorized,
                  AVAudioSession.sharedInstance().recordPermission == .granted else {
                call.reject("not-allowed", "not-allowed")
                return
            }
            guard let rec = SFSpeechRecognizer(locale: Locale(identifier: lang)), rec.isAvailable else {
                call.reject("unavailable", "unavailable")
                return
            }
            self.teardown()
            self.synth.stopSpeaking(at: .immediate)
            self.recognizer = rec
            self.lastText = ""
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .duckOthers])
                try session.setActive(true, options: .notifyOthersOnDeactivation)

                let req = SFSpeechAudioBufferRecognitionRequest()
                req.shouldReportPartialResults = true
                self.request = req

                let input = self.audioEngine.inputNode
                let format = input.outputFormat(forBus: 0)
                input.removeTap(onBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                    self.request?.append(buffer)
                }
                self.audioEngine.prepare()
                try self.audioEngine.start()
                self.active = true

                self.task = rec.recognitionTask(with: req) { result, error in
                    if let result = result {
                        self.lastText = result.bestTranscription.formattedString
                        self.notifyListeners("result", data: ["text": self.lastText])
                    }
                    if error != nil && self.active {
                        // Error real (no un "parar" del usuario): se corta y se avisa.
                        let nsErr = error! as NSError
                        let code = nsErr.code == 1110 ? "no-speech" : (nsErr.domain == NSURLErrorDomain ? "network" : "error")
                        self.active = false
                        self.teardown()
                        if self.lastText.isEmpty {
                            self.notifyListeners("error", data: ["code": code])
                        }
                    }
                }
                call.resolve()
            } catch {
                self.teardown()
                call.reject("error", "error")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.active = false
            self.request?.endAudio()
            // Pequeño margen para que llegue el último trozo reconocido.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                let text = self.lastText
                self.teardown()
                call.resolve(["text": text])
            }
        }
    }

    private func teardown() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // ── Lectura en voz alta ───────────────────────────────────────────────────
    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let lang = call.getString("lang") ?? "es-ES"
        let rate = call.getFloat("rate") ?? 0.9
        DispatchQueue.main.async {
            guard !text.isEmpty else { call.resolve(); return }
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try? AVAudioSession.sharedInstance().setActive(true)
            self.synth.stopSpeaking(at: .immediate)
            let utt = AVSpeechUtterance(string: text)
            utt.voice = AVSpeechSynthesisVoice(language: lang)
            utt.rate = AVSpeechUtteranceDefaultSpeechRate * max(0.5, min(rate, 1.5))
            self.synth.speak(utt)
            call.resolve()
        }
    }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synth.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }
}
