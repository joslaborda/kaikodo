/**
 * Stable, deterministic image resolution for trips.
 * Priority: cover_image → first city → country → destination → fallback
 */

const CITY_IMAGES = {
  'tokyo':'photo-1540959733332-eab4deabeeaf','kyoto':'photo-1493976040374-85c8e12f0c0e','osaka':'photo-1590559899731-a382839e5549','hiroshima':'photo-1528360983277-13d401cdc186','nara':'photo-1545569341-9eb8b30979d9','hakone':'photo-1578271887552-5ac3a72752bc','sapporo':'photo-1478436127897-769e1b3f0f36','fukuoka':'photo-1535979863199-3c77338429a0','nikko':'photo-1554797589-7241bb691973',
  'bangkok':'photo-1508009603885-50cf7c579365','chiang mai':'photo-1528181304800-259b08848526','phuket':'photo-1504214208698-ea1916a55c36','seoul':'photo-1517154421773-0529f29ea451','busan':'photo-1601621915196-2621bfb0cd6e','singapore':'photo-1525625293386-3f8f99389edd','hong kong':'photo-1518509562904-e7ef99cdcc86','beijing':'photo-1508804185872-d7badad00f7d','shanghai':'photo-1474181487882-5abf3f0ba6c2','bali':'photo-1518548419970-58e3b4079ab2','ubud':'photo-1537996194471-e657df975ab4','hanoi':'photo-1557750255-c76072a7aad1','ho chi minh':'photo-1583417319070-4a69db38a482','hoi an':'photo-1559592413-7cec4d0cae2b','kuala lumpur':'photo-1596422846543-75c6fc197f07','kathmandu':'photo-1544735716-392fe2489ffa','mumbai':'photo-1529253355930-ddbe423a2ac7','delhi':'photo-1587474260584-136574528ed5','agra':'photo-1564507592333-c60657eea523','jaipur':'photo-1477587458883-47145ed31fd1',
  'dubai':'photo-1512453979798-5ea266f8880c','abu dhabi':'photo-1512632578888-169bbbc64f33','istanbul':'photo-1524231757912-21f4fe3a7200','cappadocia':'photo-1570856906951-9dac4a9c93db','petra':'photo-1579606032821-4d6ea1cf3ea8','tel aviv':'photo-1548519651-4611aa4a8f6a','jerusalem':'photo-1562979314-bee7453e911c',
  'cairo':'photo-1539650116574-75c0c6d73f6e','el cairo':'photo-1539650116574-75c0c6d73f6e','luxor':'photo-1568322445389-f64ac2515020','asuan':'photo-1568322445389-f64ac2515020','marrakech':'photo-1539020140153-e479b8c22e70','fez':'photo-1548018560-c7196548169e','casablanca':'photo-1549233233-d5ef64800085','nairobi':'photo-1611348586804-61bf6c080437','cape town':'photo-1580060839134-75a5edca2e99','ciudad del cabo':'photo-1580060839134-75a5edca2e99',
  'paris':'photo-1502602898657-3e91760cbb34','nice':'photo-1533757704860-384bc8f3ac0f','lyon':'photo-1523906834658-6e24ef2386f9','rome':'photo-1552832230-c0197dd311b5','florence':'photo-1543429257-3eb0b9c80b13','venice':'photo-1514890547357-a9ee288728e0','milan':'photo-1520466809213-7b9a56adcd45','amalfi':'photo-1614977645540-7abd88ba8e42','barcelona':'photo-1539037116277-4db20889f2d4','madrid':'photo-1543783207-ec64e4d95325','sevilla':'photo-1541909329-c8845d35cc21','granada':'photo-1558642084-fd07fae5282e','amsterdam':'photo-1534351590666-13e3e96b5902','amsteradan':'photo-1534351590666-13e3e96b5902','london':'photo-1513635269975-59663e0ac1ad','edinburgh':'photo-1609611804316-3fc0b3c0d9be','berlin':'photo-1560969184-10fe8719e047','munich':'photo-1595867818082-083862f3d630','prague':'photo-1541849546-216549ae216d','viena':'photo-1516550893923-42d28e5677af','vienna':'photo-1516550893923-42d28e5677af','budapest':'photo-1549213783-8284d0336c4f','lisbon':'photo-1555881400-74d7acaacd8b','lisboa':'photo-1555881400-74d7acaacd8b','porto':'photo-1555881400-74d7acaacd8b','oporto':'photo-1555881400-74d7acaacd8b','athens':'photo-1533105079780-92b9be482077','atenas':'photo-1533105079780-92b9be482077','santorini':'photo-1570077188670-e3a8d69ac5ff','mykonos':'photo-1570077188670-e3a8d69ac5ff','dubrovnik':'photo-1599982890963-3aabd60064d2','split':'photo-1599982890963-3aabd60064d2','krakow':'photo-1557704835-d93a3b08e7a5','warsaw':'photo-1519197924294-4ba991a11128','brussels':'photo-1559113513-d5f6a1b99660','reykjavik':'photo-1531168556467-80aace0d0144','oslo':'photo-1513519245088-0e12902e5a38','stockholm':'photo-1509356843151-3e7d96241e11','copenhagen':'photo-1513622470522-26c3c8a854bc','copenhague':'photo-1513622470522-26c3c8a854bc','helsinki':'photo-1565843708714-52ecf69ab81f','zurich':'photo-1515488764276-beab7607c1e6','tallinn':'photo-1580867011774-9e249fec9c22','riga':'photo-1552581234-26160f608093','moscow':'photo-1513326738677-b964603b136d','moscu':'photo-1513326738677-b964603b136d',
  'new york':'photo-1496442226666-8d4d0e62e6e9','los angeles':'photo-1580655653885-65763b2597d0','miami':'photo-1533106497176-45ae19e68ba2','san francisco':'photo-1501594907352-04cda38ebc29','chicago':'photo-1477959858617-67f85cf4f1df','las vegas':'photo-1534430480872-3498386e7856','cancun':'photo-1552074284-5e88ef1aef18','tulum':'photo-1541963463532-d153efbf1b5c','ciudad de mexico':'photo-1518659526054-190340b32735','mexico city':'photo-1518659526054-190340b32735','havana':'photo-1500759285222-a95626b934cb','la habana':'photo-1500759285222-a95626b934cb','bogota':'https://images.pexels.com/photos/1122640/pexels-photo-1122640.jpeg?auto=compress&cs=tinysrgb&w=800','bogotá':'https://images.pexels.com/photos/1122640/pexels-photo-1122640.jpeg?auto=compress&cs=tinysrgb&w=800','medellin':'https://images.pexels.com/photos/3290068/pexels-photo-3290068.jpeg?auto=compress&cs=tinysrgb&w=800','medellín':'https://images.pexels.com/photos/3290068/pexels-photo-3290068.jpeg?auto=compress&cs=tinysrgb&w=800','salento':'https://images.pexels.com/photos/3601425/pexels-photo-3601425.jpeg?auto=compress&cs=tinysrgb&w=800','cali':'photo-1558618666-fcd25c85cd64','cartagena':'https://images.pexels.com/photos/4388164/pexels-photo-4388164.jpeg?auto=compress&cs=tinysrgb&w=800','cartagena de indias':'https://images.pexels.com/photos/4388164/pexels-photo-4388164.jpeg?auto=compress&cs=tinysrgb&w=800','lima':'photo-1526392060635-9d6019884377','cusco':'photo-1526392060635-9d6019884377','machu picchu':'photo-1526392060635-9d6019884377','rio de janeiro':'photo-1483729558449-99ef09a8c325','sao paulo':'photo-1556742049-0cfed4f6a45d','santiago':'photo-1501854140801-50d01698950b','buenos aires':'photo-1589909202802-8f4aadce1849','montevideo':'photo-1580060839134-75a5edca2e99','quito':'photo-1531968455001-5c5272a41129','la paz':'photo-1531968455001-5c5272a41129','asuncion':'photo-1589909202802-8f4aadce1849','panama':'photo-1512813195386-6cf811ad3542','san jose':'photo-1518181835702-6be7e1ad7f05','manuel antonio':'photo-1518181835702-6be7e1ad7f05','la fortuna':'photo-1518181835702-6be7e1ad7f05','toronto':'photo-1517090504586-fde19ea6a9d2','vancouver':'photo-1559511260-b56f4f4cf17e','sydney':'photo-1506905925346-21bda4d32df4','melbourne':'photo-1514395462421-6a99dc2e0fce','auckland':'photo-1507699622108-4be3abd695ad','queenstown':'photo-1507699622108-4be3abd695ad',
  // Bug reportado por José (14 sep 2026): "Dublin" no estaba en ningún
  // diccionario (ni ciudad ni país), así que un viaje a Dublín caía siempre
  // al fallback determinista por trip.id — no cambiaba edites lo que
  // edites, dando la sensación de que la foto "no se actualiza".
  'dublin':'photo-1751235332466-11b46e3c635a','galway':'photo-1751235332466-11b46e3c635a','cork':'photo-1751235332466-11b46e3c635a','belfast':'photo-1590089415225-401ed6f9db8e',
};

const COUNTRY_IMAGES = {
  'japan':'photo-1493976040374-85c8e12f0c0e','japon':'photo-1493976040374-85c8e12f0c0e','france':'photo-1502602898657-3e91760cbb34','francia':'photo-1502602898657-3e91760cbb34','italy':'photo-1523906834658-6e24ef2386f9','italia':'photo-1523906834658-6e24ef2386f9','spain':'photo-1543783207-ec64e4d95325','espana':'photo-1543783207-ec64e4d95325','portugal':'photo-1555881400-74d7acaacd8b','germany':'photo-1560969184-10fe8719e047','alemania':'photo-1560969184-10fe8719e047','uk':'photo-1513635269975-59663e0ac1ad','united kingdom':'photo-1513635269975-59663e0ac1ad','reino unido':'photo-1513635269975-59663e0ac1ad','england':'photo-1513635269975-59663e0ac1ad','ireland':'photo-1751235332466-11b46e3c635a','irlanda':'photo-1751235332466-11b46e3c635a','republic of ireland':'photo-1751235332466-11b46e3c635a','northern ireland':'photo-1590089415225-401ed6f9db8e','netherlands':'photo-1534351590666-13e3e96b5902','holanda':'photo-1534351590666-13e3e96b5902','paises bajos':'photo-1534351590666-13e3e96b5902','greece':'photo-1533105079780-92b9be482077','grecia':'photo-1533105079780-92b9be482077','turkey':'photo-1524231757912-21f4fe3a7200','turquia':'photo-1524231757912-21f4fe3a7200','croatia':'photo-1599982890963-3aabd60064d2','croacia':'photo-1599982890963-3aabd60064d2','czech republic':'photo-1541849546-216549ae216d','republica checa':'photo-1541849546-216549ae216d','hungary':'photo-1549213783-8284d0336c4f','hungria':'photo-1549213783-8284d0336c4f','poland':'photo-1519197924294-4ba991a11128','polonia':'photo-1519197924294-4ba991a11128','austria':'photo-1516550893923-42d28e5677af','switzerland':'photo-1515488764276-beab7607c1e6','suiza':'photo-1515488764276-beab7607c1e6','belgium':'photo-1559113513-d5f6a1b99660','belgica':'photo-1559113513-d5f6a1b99660','sweden':'photo-1509356843151-3e7d96241e11','suecia':'photo-1509356843151-3e7d96241e11','norway':'photo-1513519245088-0e12902e5a38','noruega':'photo-1513519245088-0e12902e5a38','denmark':'photo-1513622470522-26c3c8a854bc','dinamarca':'photo-1513622470522-26c3c8a854bc','finland':'photo-1565843708714-52ecf69ab81f','finlandia':'photo-1565843708714-52ecf69ab81f','iceland':'photo-1531168556467-80aace0d0144','islandia':'photo-1531168556467-80aace0d0144','russia':'photo-1513326738677-b964603b136d','rusia':'photo-1513326738677-b964603b136d',
  'thailand':'photo-1508009603885-50cf7c579365','tailandia':'photo-1508009603885-50cf7c579365','south korea':'photo-1517154421773-0529f29ea451','corea del sur':'photo-1517154421773-0529f29ea451','indonesia':'photo-1518548419970-58e3b4079ab2','vietnam':'photo-1557750255-c76072a7aad1','china':'photo-1474181487882-5abf3f0ba6c2','singapore':'photo-1525625293386-3f8f99389edd','singapur':'photo-1525625293386-3f8f99389edd','india':'photo-1587474260584-136574528ed5','malaysia':'photo-1596422846543-75c6fc197f07','malasia':'photo-1596422846543-75c6fc197f07','nepal':'photo-1544735716-392fe2489ffa','sri lanka':'photo-1546708770-599a3abdf230','cambodia':'photo-1560791941-e3b4c5b26d6c','camboya':'photo-1560791941-e3b4c5b26d6c','philippines':'photo-1551244072-5d12893278bc','filipinas':'photo-1551244072-5d12893278bc',
  'uae':'photo-1512453979798-5ea266f8880c','emiratos arabes':'photo-1512453979798-5ea266f8880c','jordan':'photo-1579606032821-4d6ea1cf3ea8','jordania':'photo-1579606032821-4d6ea1cf3ea8','israel':'photo-1548519651-4611aa4a8f6a',
  'egypt':'photo-1539650116574-75c0c6d73f6e','egipto':'photo-1539650116574-75c0c6d73f6e','morocco':'photo-1539020140153-e479b8c22e70','marruecos':'photo-1539020140153-e479b8c22e70','kenya':'photo-1611348586804-61bf6c080437','south africa':'photo-1580060839134-75a5edca2e99','sudafrica':'photo-1580060839134-75a5edca2e99','tanzania':'photo-1516026672322-bc52d61a55d5',
  'usa':'photo-1496442226666-8d4d0e62e6e9','united states':'photo-1496442226666-8d4d0e62e6e9','estados unidos':'photo-1496442226666-8d4d0e62e6e9','mexico':'photo-1552074284-5e88ef1aef18','cuba':'photo-1500759285222-a95626b934cb','saint-martin':'photo-1533106497176-45ae19e68ba2','saint martin':'photo-1533106497176-45ae19e68ba2','sint maarten':'photo-1533106497176-45ae19e68ba2','martinica':'photo-1533106497176-45ae19e68ba2','guadalupe':'photo-1533106497176-45ae19e68ba2','colombia':'https://images.pexels.com/photos/3601425/pexels-photo-3601425.jpeg?auto=compress&cs=tinysrgb&w=800','peru':'photo-1526392060635-9d6019884377','brazil':'photo-1483729558449-99ef09a8c325','brasil':'photo-1483729558449-99ef09a8c325','argentina':'photo-1589909202802-8f4aadce1849','chile':'photo-1501854140801-50d01698950b','ecuador':'photo-1531968455001-5c5272a41129','bolivia':'photo-1531968455001-5c5272a41129','paraguay':'photo-1589909202802-8f4aadce1849','uruguay':'photo-1580060839134-75a5edca2e99','venezuela':'photo-1580060839134-75a5edca2e99','costa rica':'photo-1518181835702-6be7e1ad7f05','panama':'photo-1512813195386-6cf811ad3542','guatemala':'photo-1547558840-b8561d2d1b07','honduras':'photo-1547558840-b8561d2d1b07','nicaragua':'photo-1547558840-b8561d2d1b07','el salvador':'photo-1547558840-b8561d2d1b07','dominican republic':'photo-1552074284-5e88ef1aef18','republica dominicana':'photo-1552074284-5e88ef1aef18','canada':'photo-1517090504586-fde19ea6a9d2','australia':'photo-1506905925346-21bda4d32df4','nueva zelanda':'photo-1507699622108-4be3abd695ad','new zealand':'photo-1507699622108-4be3abd695ad',
  // ── Caribe completo ────────────────────────────────────────────────────────
  'martinica':'photo-1533106497176-45ae19e68ba2','guadalupe':'photo-1533106497176-45ae19e68ba2',
  'saint-martin':'photo-1533106497176-45ae19e68ba2','saint martin':'photo-1533106497176-45ae19e68ba2',
  'sint maarten':'photo-1533106497176-45ae19e68ba2','san bartolome':'photo-1533106497176-45ae19e68ba2',
  'bermudas':'photo-1533106497176-45ae19e68ba2','aruba':'photo-1526481280693-3bfa7568e0f3',
  'curazao':'photo-1526481280693-3bfa7568e0f3','bonaire':'photo-1526481280693-3bfa7568e0f3',
  'puerto rico':'photo-1579026996658-3a57b6b5f03b','trinidad y tobago':'photo-1527430253228-e93688616381',
  'barbados':'photo-1533104316073-15749504f4a8','bahamas':'photo-1548574505-5e239809ee19',
  'jamaica':'photo-1538332576228-eb5b4c4de6f5','haiti':'photo-1574843716311-c5a68d4c7b57',
  'republica dominicana':'photo-1506929562872-bb421503ef21','dominican republic':'photo-1506929562872-bb421503ef21',
  'santa lucia':'photo-1542314831-068cd1dbfeeb','san vicente':'photo-1542314831-068cd1dbfeeb',
  'antigua y barbuda':'photo-1576085898323-f9fc8a8b3b03','granada':'photo-1596706312369-5fc8c69c2b41',
  'dominica':'photo-1578894381163-e72c17f2d45f','san cristobal y nieves':'photo-1576085898323-f9fc8a8b3b03',
  'islas caiman':'photo-1548574505-5e239809ee19','islas turcos y caicos':'photo-1548574505-5e239809ee19',
  'islas virgenes':'photo-1548574505-5e239809ee19','guyana':'photo-1558618047-3c9e9b2dc4f6',
  'guyana francesa':'photo-1558618047-3c9e9b2dc4f6','surinam':'photo-1558618047-3c9e9b2dc4f6',

  // ── Oceanía completa ───────────────────────────────────────────────────────
  'papua nueva guinea':'photo-1577717903315-1691ae25ab3f','islas salomon':'photo-1541840031508-a3b1c44c9a79',
  'vanuatu':'photo-1540202404-d0c7fe46a087','samoa':'photo-1530870110042-98b2cb110834',
  'tonga':'photo-1575999502951-4ab25b5ca889','kiribati':'photo-1559827260-dc66d52bef19',
  'polinesia francesa':'photo-1559827260-dc66d52bef19','tahiti':'photo-1559827260-dc66d52bef19',
  'nueva caledonia':'photo-1559827260-dc66d52bef19','palaos':'photo-1559827260-dc66d52bef19',
  'micronesia':'photo-1517057983537-e8cae6a36b57','islas marshall':'photo-1517057983537-e8cae6a36b57',
  'guam':'photo-1596452006208-6e41d1e2f7da','islas cook':'photo-1496080174650-637e3f22fa03',
  'fiji':'photo-1589553090991-2e5c2f2e01a2','fiyi':'photo-1589553090991-2e5c2f2e01a2',

  // ── África completa ────────────────────────────────────────────────────────
  'cabo verde':'photo-1580060839134-75a5edca2e99','seychelles':'photo-1573843981267-be1480eca5b4',
  'mauricio':'photo-1571406252241-db0280bd38db','reunion':'photo-1617869623861-56e028bca0b8',
  'ghana':'photo-1534430480872-3498386e7856','nigeria':'photo-1577083288073-40892c0860a4',
  'senegal':'photo-1576426863848-c21f53c60b19','camaron':'photo-1558618666-fcd25c85cd64',
  'angola':'photo-1558618047-3c9e9b2dc4f6','mozambique':'photo-1489493585363-d69421e0edd3',
  'zambia':'photo-1516026672322-bc52d61a55d5','zimbabue':'photo-1516026672322-bc52d61a55d5',
  'botswana':'photo-1516026672322-bc52d61a55d5','botsuana':'photo-1516026672322-bc52d61a55d5',
  'namibia':'photo-1565965194565-59e87d3bf07e','madagascar':'photo-1562802378-063ec186a863',
  'costa de marfil':'photo-1576426863848-c21f53c60b19','mali':'photo-1504432842672-1a79f78e4084',
  'guinea ecuatorial':'photo-1558618666-fcd25c85cd64','comoras':'photo-1573843981267-be1480eca5b4',
  'etiopia':'photo-1523805009345-7448845a9e53','eritrea':'photo-1523805009345-7448845a9e53',
  'yibuti':'photo-1523805009345-7448845a9e53','somalia':'photo-1523805009345-7448845a9e53',
  'uganda':'photo-1516026672322-bc52d61a55d5','burundi':'photo-1516026672322-bc52d61a55d5',
  'malawi':'photo-1516026672322-bc52d61a55d5','malaui':'photo-1516026672322-bc52d61a55d5',
  'lesoto':'photo-1580060839134-75a5edca2e99','esuatini':'photo-1580060839134-75a5edca2e99',

  // ── Asia completa ──────────────────────────────────────────────────────────
  'hong kong':'photo-1518509562904-e7ef99cdcc86','macao':'photo-1503925802536-c9451dcd87b9',
  'taiwan':'photo-1470229722913-7c0e2dbbafd3','mongolia':'photo-1573040186-28ade2e2c4c5',
  'afganistan':'photo-1558618047-3c9e9b2dc4f6','tayikistan':'photo-1558618047-3c9e9b2dc4f6',
  'turkmenistan':'photo-1558618047-3c9e9b2dc4f6','uzbekistan':'photo-1558618047-3c9e9b2dc4f6',

  // ── Europa territorios ─────────────────────────────────────────────────────
  'gibraltar':'photo-1558370781-d6196949e317','liechtenstein':'photo-1515488764276-beab7607c1e6',
  'san marino':'photo-1558370781-d6196949e317','ciudad del vaticano':'photo-1558370781-d6196949e317',
  'islas feroe':'photo-1531168556467-80aace0d0144','groenlandia':'photo-1531168556467-80aace0d0144',
  'isla de man':'photo-1513635269975-59663e0ac1ad','jersey':'photo-1513635269975-59663e0ac1ad',
  'guernsey':'photo-1513635269975-59663e0ac1ad','svalbard':'photo-1531168556467-80aace0d0144',
  'aland':'photo-1565843708714-52ecf69ab81f',

  // ── Américas territorios ───────────────────────────────────────────────────
  'belice':'photo-1552074284-5e88ef1aef18','islas malvinas':'photo-1580060839134-75a5edca2e99',
  'groenlandia':'photo-1531168556467-80aace0d0144',
  // ── Micro-estados y países sin foto propia → usar país cercano ──────────────
  'andorra':'photo-1558618047-f4cac43b1ee4',          // Pirineos como España
  'monaco':'photo-1558618666-fcd25c85cd64',            // Costa Azul
  // Estas dos claves ya existían arriba (línea 72) con el mismo comentario de
  // intención ("similar a Italia"/"alpino como Suiza") pero con IDs de foto
  // copiados por error de Egipto y Australia respectivamente — como es un
  // objeto literal, esta segunda definición pisaba silenciosamente a la
  // primera y ganaba la incorrecta. Ahora sí usan la foto real de Italia/Suiza.
  'san marino':'photo-1523906834658-6e24ef2386f9',     // = 'italia' (línea 16)
  'liechtenstein':'photo-1515488764276-beab7607c1e6',  // = 'suiza' (línea 16)
  'kosovo':'photo-1558618047-f4cac43b1ee4',            // Balcanes
  'timor oriental':'photo-1518509562904-e7ef99cdcc86', // Similar Indonesia
  'brunei':'photo-1508702973812-62b6a9e50aeb',         // Similar Malasia
  'tuvalu':'photo-1507699622108-4be3abd695ad',          // Pacífico
  'nauru':'photo-1507699622108-4be3abd695ad',           // Pacífico
  'kiribati':'photo-1507699622108-4be3abd695ad',        // Pacífico
  'marshall islands':'photo-1507699622108-4be3abd695ad', // Pacífico
  'palau':'photo-1518509562904-e7ef99cdcc86',           // Pacífico tropical
  'solomon islands':'photo-1518509562904-e7ef99cdcc86', // Pacífico
  'micronesia':'photo-1507699622108-4be3abd695ad',      // Pacífico

};

const FALLBACK_IMAGES = [
  'photo-1488085061387-422e29b40080',
  'photo-1476514525535-07fb3b4ae5f1',
  'photo-1530521954074-e64f6810b32d',
  'photo-1506012787146-f92b2d7d6d96',
];

function unsplashUrl(photoId, width = 800) {
  // If already a full URL (Pexels or other), return as-is
  if (photoId && (photoId.startsWith('http://') || photoId.startsWith('https://'))) {
    return photoId;
  }
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=${width}&q=80`;
}

function normalize(str = '') {
  return str.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function lookupCity(cityName) {
  if (!cityName) return null;
  const key = normalize(cityName);
  // Exact match
  if (CITY_IMAGES[key]) return unsplashUrl(CITY_IMAGES[key]);
  // Partial: only if key length >= 4 to avoid false positives
  for (const [k, v] of Object.entries(CITY_IMAGES)) {
    if (k.length >= 4 && key === k) return unsplashUrl(v);
    if (k.length >= 5 && key.startsWith(k)) return unsplashUrl(v);
  }
  return null;
}

function lookupCountry(countryName) {
  if (!countryName) return null;
  const key = normalize(countryName);
  // Exact match first — prevents 'india' matching inside 'indonesia' or 'colombia'
  if (COUNTRY_IMAGES[key]) return unsplashUrl(COUNTRY_IMAGES[key]);
  // Only allow partial if key is 5+ chars to avoid false positives
  if (key.length >= 5) {
    for (const [k, v] of Object.entries(COUNTRY_IMAGES)) {
      if (k.length >= 5 && key === k) return unsplashUrl(v);
    }
    // Last resort: key starts with dict key (e.g. 'costa rica' starts with 'costa')
    for (const [k, v] of Object.entries(COUNTRY_IMAGES)) {
      if (k.length >= 6 && key.startsWith(k)) return unsplashUrl(v);
    }
  }
  return null;
}

export function getTripCoverImage(trip, cities = []) {
  // 1. Cities (sorted by order) — try city image and city's country
  if (cities.length > 0) {
    const sorted = [...cities].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const city of sorted) {
      const img = lookupCity(city.name) || lookupCountry(city.country);
      if (img) return img;
    }
  }
  // 2. Trip country field
  const countryImg = lookupCountry(trip?.country) || lookupCountry(trip?.destination);
  if (countryImg) return countryImg;
  // 3. Trip name or destination as city/country lookup
  const nameImg = lookupCity(trip?.name) || lookupCountry(trip?.name) || lookupCity(trip?.destination);
  if (nameImg) return nameImg;
  // 4. Deterministic fallback from trip id
  if (trip?.id) {
    const idx = trip.id.charCodeAt(0) % FALLBACK_IMAGES.length;
    return unsplashUrl(FALLBACK_IMAGES[idx]);
  }
  return unsplashUrl(FALLBACK_IMAGES[0]);
}

// José (15 sep 2026): "no puedes usar fotos de Google Maps cuando te digan
// la ciudad? solucionaría todo" -- tenía razón, es la solución de verdad
// en vez de seguir ampliando el diccionario fijo de arriba ciudad a
// ciudad (que se queda corto siempre: pasó con Dublín, con León...).
//
// getTripCoverImage() de arriba sigue existiendo tal cual -- sigue siendo
// el fallback SÍNCRONO instantáneo (nunca hay parpadeo ni hueco en blanco
// mientras carga nada). Este hook lo usa como valor inicial y, SOLO si la
// primera ciudad del viaje tiene photo_ref guardado (ver City.jsonc,
// capturado al añadir la ciudad vía CityInput+Google Places), pide en
// segundo plano la URL real de la foto y sustituye el fallback por la
// buena en cuanto llega -- mejora progresiva, nunca bloqueante.
// José (23 sep 2026): ya NO se usan fotos de Google Places para la portada:
// los términos EEA de Google Maps Platform no permiten guardar la referencia
// de foto ni pintar fotos de Places fuera de Places UI Kit. Se queda el
// fallback propio (getTripCoverImage). Se mantiene el hook para no tocar a
// quien lo usa.
export function useTripCoverImage(trip, cities = []) {
  return getTripCoverImage(trip, cities);
}