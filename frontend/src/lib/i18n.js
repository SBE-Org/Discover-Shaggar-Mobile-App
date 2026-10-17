// Interface language and translated content (spec 9.3).
// Content: each record stores name / name_om / name_am etc.; tr() falls back to English and reports when it did.
// Interface strings below for Afaan Oromoo and Amharic are a first draft and must be reviewed by native speakers
// before launch (the spec asks for human review of translations).
import { CATALOG_I18N, SECTORS, typeLabel } from '../shared/catalog.js';

const KEY = 'sdc-lang';
let lang = 'en';
try { lang = localStorage.getItem(KEY) || (navigator.language || '').slice(0, 2); } catch { /* storage blocked */ }
if (!['en', 'om', 'am'].includes(lang)) lang = 'en';

export const getLang = () => lang;
export function setLang(l) {
  lang = ['en', 'om', 'am'].includes(l) ? l : 'en';
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
}
document.documentElement.lang = lang;

/** Translated field of a record, falling back to English. */
export function tr(rec, field) {
  if (!rec) return '';
  if (lang !== 'en') { const v = rec[field + '_' + lang]; if (v) return v; }
  return rec[field] || '';
}
/** True when the current language is not English and this field has no translation. */
export const missing = (rec, field) => lang !== 'en' && !!rec?.[field] && !rec[field + '_' + lang];

export const sectorName = (k) => (lang !== 'en' && CATALOG_I18N[k]?.[lang]) || SECTORS[k]?.label || k;
export const typeName = (s, t) => (lang !== 'en' && CATALOG_I18N[s + '/' + t]?.[lang]) || typeLabel(s, t);

const S = {
  en: {
    'nav.home': 'Home', 'nav.map': 'Map', 'nav.areas': 'Areas', 'nav.trips': 'Trips', 'nav.saved': 'Saved', 'nav.more': 'More', 'nav.admin': 'Admin',
    'home.hello': 'Discover', 'home.sub': 'Verified places across all 12 sub-cities.', 'home.search': 'Search places, services, landmarks',
    'home.categories': 'Browse by category', 'home.featured': 'Featured places', 'home.upcoming': 'Upcoming trips & events', 'home.areas': 'Explore a sub-city',
    'home.discover': 'Things to see', 'home.plan': 'Plan a visit', 'home.plan_sub': 'A 1–3 day itinerary that keeps each day’s stops close together.',
    'home.recent': 'Recently viewed', 'home.nearme': 'Near me', 'see_all': 'See all',
    'act.directions': 'Directions', 'act.share': 'Share', 'act.save': 'Save', 'act.saved': 'Saved', 'act.report': 'Report a problem', 'act.near': 'Near here',
    'act.onmap': 'On map', 'act.fix': 'Suggest a fix', 'act.edit': 'Edit',
    'p.verified': 'Verified on site', 'p.unverified': 'Not yet verified', 'p.hours': 'Hours', 'p.phone': 'Phone', 'p.email': 'Email', 'p.website': 'Website',
    'p.open': 'Open now', 'p.closed': 'Closed now', 'p.lastver': 'Last verified', 'p.stale': 'This information may be out of date. It is due for review.',
    'p.facilities': 'Facilities', 'p.access': 'Accessibility', 'p.tips': 'Visitor guidance', 'p.safety': 'Safety', 'p.trmissing': 'Not yet translated. Showing English.',
    'p.notlisted': 'Not listed',
    't.upcoming': 'Upcoming', 't.past': 'Past', 't.register': 'Register', 't.enquire': 'Send an enquiry', 't.full': 'Full', 't.free': 'Free',
    't.meeting': 'Meeting point', 't.bring': 'What to bring', 't.stops': 'Stops', 't.route': 'Show route on map', 't.spots': 'places left', 't.updates': 'Updates',
    't.none': 'No upcoming trips yet', 't.none_sub': 'Trips, festivals and community events appear here once the Bureau publishes them.',
    'm.language': 'Language', 'm.suggest': 'Suggest a place', 'm.track': 'Track a report or registration', 'm.staff': 'Staff sign in', 'm.info': 'Information',
    'saved.empty': 'Nothing saved yet', 'saved.empty_sub': 'Tap the bookmark on any place to keep it here, also without a connection.',
  },
  om: {
    'nav.home': 'Mana', 'nav.map': 'Kaartaa', 'nav.areas': 'Kutaalee', 'nav.trips': 'Imala', 'nav.saved': 'Kuufame', 'nav.more': 'Dabalata', 'nav.admin': 'Bulchiinsa',
    'home.hello': 'Shaggar Argadhu', 'home.sub': 'Bakkeewwan mirkanaa’an magaalaa xiqqaa 12 hunda keessatti.', 'home.search': 'Bakka, tajaajila ykn mallattoo barbaadi',
    'home.categories': 'Gosaan ilaali', 'home.featured': 'Bakkeewwan filatamoo', 'home.upcoming': 'Imala fi taateewwan dhufan', 'home.areas': 'Magaalaa xiqqaa ilaali',
    'home.discover': 'Wantoota ilaalamuu qaban', 'home.plan': 'Daawwannaa karoorsi', 'home.plan_sub': 'Sagantaa guyyaa 1–3, bakkeewwan walitti dhiyoo.',
    'home.recent': 'Dhiyeenya kana kan ilaalte', 'home.nearme': 'Natti dhiyoo', 'see_all': 'Hunda ilaali',
    'act.directions': 'Kallattii', 'act.share': 'Qoodi', 'act.save': 'Kuusi', 'act.saved': 'Kuufameera', 'act.report': 'Rakkoo gabaasi', 'act.near': 'Asitti dhiyoo',
    'act.onmap': 'Kaartaa irratti', 'act.fix': 'Sirreeffama yaadi', 'act.edit': 'Gulaali',
    'p.verified': 'Bakka irratti mirkanaa’e', 'p.unverified': 'Ammallee hin mirkanoofne', 'p.hours': 'Sa’aatii', 'p.phone': 'Bilbila', 'p.email': 'Imeelii', 'p.website': 'Marsariitii',
    'p.open': 'Amma banaa', 'p.closed': 'Amma cufaa', 'p.lastver': 'Yeroo dhumaaf kan mirkanaa’e', 'p.stale': 'Odeeffannoon kun moofaa ta’uu danda’a. Irra deebiin ilaalamuu qaba.',
    'p.facilities': 'Tajaajila', 'p.access': 'Dhaqqabamummaa', 'p.tips': 'Qajeelfama daawwattootaa', 'p.safety': 'Nageenya', 'p.trmissing': 'Ammallee hin hiikamne. Afaan Ingilizii agarsiisaa jira.',
    'p.notlisted': 'Hin galmoofne',
    't.upcoming': 'Kan dhufan', 't.past': 'Kan darban', 't.register': 'Galmaa’i', 't.enquire': 'Gaaffii ergi', 't.full': 'Guutameera', 't.free': 'Bilisa',
    't.meeting': 'Bakka walitti dhufeenyaa', 't.bring': 'Waan qabattan', 't.stops': 'Bakkeewwan', 't.route': 'Karaa kaartaa irratti agarsiisi', 't.spots': 'bakka hafe', 't.updates': 'Haaromsa',
    't.none': 'Ammaaf imalli hin jiru', 't.none_sub': 'Imala, ayyaanota fi taateewwan hawaasaa Biiroon yeroo maxxansu asitti mul’atu.',
    'm.language': 'Afaan', 'm.suggest': 'Bakka yaadi', 'm.track': 'Gabaasa ykn galmee hordofi', 'm.staff': 'Seensa hojjettootaa', 'm.info': 'Odeeffannoo',
    'saved.empty': 'Ammallee waan kuufame hin jiru', 'saved.empty_sub': 'Bakka kamiyyuu kuusuuf mallattoo tuqi; interneetii malees ni argamu.',
  },
  am: {
    'nav.home': 'መነሻ', 'nav.map': 'ካርታ', 'nav.areas': 'ክፍለ ከተሞች', 'nav.trips': 'ጉዞዎች', 'nav.saved': 'የተቀመጡ', 'nav.more': 'ተጨማሪ', 'nav.admin': 'አስተዳደር',
    'home.hello': 'ሸገርን ያግኙ', 'home.sub': 'በ12ቱም ክፍለ ከተሞች የተረጋገጡ ቦታዎች።', 'home.search': 'ቦታ፣ አገልግሎት ወይም ምልክት ይፈልጉ',
    'home.categories': 'በዘርፍ ያስሱ', 'home.featured': 'ተመራጭ ቦታዎች', 'home.upcoming': 'የሚመጡ ጉዞዎችና ዝግጅቶች', 'home.areas': 'ክፍለ ከተማ ያስሱ',
    'home.discover': 'የሚታዩ ነገሮች', 'home.plan': 'ጉብኝት ያቅዱ', 'home.plan_sub': 'የ1–3 ቀን ዕቅድ፣ በየቀኑ ቦታዎቹ ቅርብ ለቅርብ።',
    'home.recent': 'በቅርቡ የታዩ', 'home.nearme': 'በአቅራቢያዬ', 'see_all': 'ሁሉንም ይመልከቱ',
    'act.directions': 'አቅጣጫ', 'act.share': 'አጋራ', 'act.save': 'አስቀምጥ', 'act.saved': 'ተቀምጧል', 'act.report': 'ችግር ሪፖርት አድርግ', 'act.near': 'እዚህ አቅራቢያ',
    'act.onmap': 'በካርታ ላይ', 'act.fix': 'እርማት ጠቁም', 'act.edit': 'አርትዕ',
    'p.verified': 'በቦታው ተረጋግጧል', 'p.unverified': 'ገና አልተረጋገጠም', 'p.hours': 'የሥራ ሰዓት', 'p.phone': 'ስልክ', 'p.email': 'ኢሜይል', 'p.website': 'ድረ ገጽ',
    'p.open': 'አሁን ክፍት ነው', 'p.closed': 'አሁን ዝግ ነው', 'p.lastver': 'ለመጨረሻ ጊዜ የተረጋገጠው', 'p.stale': 'ይህ መረጃ ጊዜው ያለፈበት ሊሆን ይችላል። እንደገና መገምገም አለበት።',
    'p.facilities': 'አገልግሎቶች', 'p.access': 'ተደራሽነት', 'p.tips': 'ለጎብኚዎች መመሪያ', 'p.safety': 'ደህንነት', 'p.trmissing': 'ገና አልተተረጎመም። በእንግሊዝኛ እየታየ ነው።',
    'p.notlisted': 'አልተመዘገበም',
    't.upcoming': 'የሚመጡ', 't.past': 'ያለፉ', 't.register': 'ይመዝገቡ', 't.enquire': 'ጥያቄ ይላኩ', 't.full': 'ሞልቷል', 't.free': 'ነፃ',
    't.meeting': 'መገናኛ ቦታ', 't.bring': 'ምን ይዘው ይምጡ', 't.stops': 'ማቆሚያዎች', 't.route': 'መንገዱን በካርታ አሳይ', 't.spots': 'ቦታ ቀርቷል', 't.updates': 'ማሻሻያዎች',
    't.none': 'ገና የሚመጣ ጉዞ የለም', 't.none_sub': 'ጉዞዎች፣ በዓላትና የማኅበረሰብ ዝግጅቶች ቢሮው ሲያወጣቸው እዚህ ይታያሉ።',
    'm.language': 'ቋንቋ', 'm.suggest': 'ቦታ ይጠቁሙ', 'm.track': 'ሪፖርት ወይም ምዝገባ ይከታተሉ', 'm.staff': 'የሠራተኞች መግቢያ', 'm.info': 'መረጃ',
    'saved.empty': 'ገና ምንም አልተቀመጠም', 'saved.empty_sub': 'ማንኛውንም ቦታ እዚህ ለማስቀመጥ ምልክቱን ይንኩ፤ ያለ ኢንተርኔትም ይገኛል።',
  },
};
/** Interface string in the current language. */
export const t = (k) => S[lang]?.[k] || S.en[k] || k;
