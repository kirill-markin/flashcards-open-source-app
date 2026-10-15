import type { LoginPageLocale } from "../routes/browser/loginPageLocale.js";

type AuthEntryCopy = Readonly<{
  title: string;
  google: string;
  apple: string;
  email: string;
  opening: string;
  methods: string;
  notCompleted: string;
}>;

export const AUTH_ENTRY_COPY: Readonly<Record<LoginPageLocale, AuthEntryCopy>> = {
  en: {
    notCompleted: "Sign-in did not complete. Choose a sign-in method to try again.",
    title: "Sign in or create an account",
    google: "Continue with Google", apple: "Continue with Apple",
    email: "Continue with email", opening: "Opening sign-in…", methods: "Other sign-in methods",
  },
  ar: {
    notCompleted: "لم يكتمل تسجيل الدخول. اختر طريقة تسجيل دخول للمحاولة مرة أخرى.",
    title: "سجّل الدخول أو أنشئ حسابًا",
    google: "المتابعة باستخدام Google", apple: "المتابعة باستخدام Apple",
    email: "المتابعة بالبريد الإلكتروني", opening: "جارٍ فتح تسجيل الدخول…", methods: "طرق تسجيل الدخول الأخرى",
  },
  "zh-Hans": {
    notCompleted: "登录未完成。请选择一种登录方式重试。",
    title: "登录或创建账户",
    google: "使用 Google 继续", apple: "使用 Apple 继续",
    email: "使用电子邮件继续", opening: "正在打开登录页面…", methods: "其他登录方式",
  },
  fr: {
    notCompleted: "La connexion n’a pas abouti. Choisissez une méthode de connexion pour réessayer.",
    title: "Se connecter ou créer un compte",
    google: "Continuer avec Google", apple: "Continuer avec Apple",
    email: "Continuer par e-mail", opening: "Ouverture de la connexion…", methods: "Autres méthodes de connexion",
  },
  de: {
    notCompleted: "Die Anmeldung wurde nicht abgeschlossen. Wähle eine Anmeldemethode, um es erneut zu versuchen.",
    title: "Anmelden oder Konto erstellen",
    google: "Mit Google fortfahren", apple: "Mit Apple fortfahren",
    email: "Mit E-Mail fortfahren", opening: "Anmeldung wird geöffnet…", methods: "Andere Anmeldemethoden",
  },
  hi: {
    notCompleted: "साइन इन पूरा नहीं हुआ। दोबारा कोशिश करने के लिए साइन इन का तरीका चुनें।",
    title: "साइन इन करें या खाता बनाएँ",
    google: "Google के साथ जारी रखें", apple: "Apple के साथ जारी रखें",
    email: "ईमेल से जारी रखें", opening: "साइन इन खुल रहा है…", methods: "साइन इन के अन्य तरीके",
  },
  ja: {
    notCompleted: "サインインが完了しませんでした。サインイン方法を選んで再試行してください。",
    title: "サインインまたはアカウント作成",
    google: "Google で続ける", apple: "Apple で続ける",
    email: "メールで続ける", opening: "サインインを開いています…", methods: "他のサインイン方法",
  },
  "pt-BR": {
    notCompleted: "A entrada não foi concluída. Escolha uma forma de entrar para tentar novamente.",
    title: "Entrar ou criar uma conta",
    google: "Continuar com Google", apple: "Continuar com Apple",
    email: "Continuar com e-mail", opening: "Abrindo a entrada…", methods: "Outras formas de entrar",
  },
  ru: {
    notCompleted: "Вход не завершён. Выберите способ входа, чтобы попробовать снова.",
    title: "Войти или создать аккаунт",
    google: "Продолжить с Google", apple: "Продолжить с Apple",
    email: "Продолжить с почтой", opening: "Открываем вход…", methods: "Другие способы входа",
  },
  "es-MX": {
    notCompleted: "No se completó el inicio de sesión. Elige una forma de iniciar sesión para volver a intentarlo.",
    title: "Iniciar sesión o crear una cuenta",
    google: "Continuar con Google", apple: "Continuar con Apple",
    email: "Continuar con correo", opening: "Abriendo el inicio de sesión…", methods: "Otras formas de iniciar sesión",
  },
  "es-ES": {
    notCompleted: "No se ha completado el inicio de sesión. Elige una forma de iniciar sesión para volver a intentarlo.",
    title: "Iniciar sesión o crear una cuenta",
    google: "Continuar con Google", apple: "Continuar con Apple",
    email: "Continuar con correo", opening: "Abriendo el inicio de sesión…", methods: "Otras formas de iniciar sesión",
  },
  bg: {
    notCompleted: "Входът не завърши. Изберете начин за вход, за да опитате отново.",
    title: "Влезте или създайте акаунт",
    google: "Продължете с Google", apple: "Продължете с Apple",
    email: "Продължете с имейл", opening: "Отваряне на входа…", methods: "Други начини за вход",
  },
  bn: {
    notCompleted: "সাইন ইন সম্পূর্ণ হয়নি। আবার চেষ্টা করতে সাইন ইন করার একটি উপায় বেছে নিন।",
    title: "সাইন ইন করুন বা অ্যাকাউন্ট তৈরি করুন",
    google: "Google দিয়ে চালিয়ে যান", apple: "Apple দিয়ে চালিয়ে যান",
    email: "ইমেইল দিয়ে চালিয়ে যান", opening: "সাইন ইন খোলা হচ্ছে…", methods: "সাইন ইন করার অন্য উপায়",
  },
  ca: {
    notCompleted: "No s’ha completat l’inici de sessió. Tria un mètode d’inici de sessió per tornar-ho a provar.",
    title: "Inicia la sessió o crea un compte",
    google: "Continua amb Google", apple: "Continua amb Apple",
    email: "Continua amb correu electrònic", opening: "S'està obrint l'inici de sessió…", methods: "Altres mètodes d'inici de sessió",
  },
  cs: {
    notCompleted: "Přihlášení nebylo dokončeno. Vyberte způsob přihlášení a zkuste to znovu.",
    title: "Přihlaste se nebo si vytvořte účet",
    google: "Pokračovat přes Google", apple: "Pokračovat přes Apple",
    email: "Pokračovat e-mailem", opening: "Otevírání přihlášení…", methods: "Další způsoby přihlášení",
  },
  da: {
    notCompleted: "Login blev ikke gennemført. Vælg en loginmetode for at prøve igen.",
    title: "Log ind eller opret en konto",
    google: "Fortsæt med Google", apple: "Fortsæt med Apple",
    email: "Fortsæt med e-mail", opening: "Åbner login…", methods: "Andre loginmetoder",
  },
  el: {
    notCompleted: "Η σύνδεση δεν ολοκληρώθηκε. Επιλέξτε τρόπο σύνδεσης για να δοκιμάσετε ξανά.",
    title: "Συνδεθείτε ή δημιουργήστε λογαριασμό",
    google: "Συνέχεια με Google", apple: "Συνέχεια με Apple",
    email: "Συνέχεια με email", opening: "Άνοιγμα σύνδεσης…", methods: "Άλλοι τρόποι σύνδεσης",
  },
  et: {
    notCompleted: "Sisselogimine jäi pooleli. Uuesti proovimiseks vali sisselogimisviis.",
    title: "Logi sisse või loo konto",
    google: "Jätka Google’iga", apple: "Jätka Apple’iga",
    email: "Jätka e-postiga", opening: "Sisselogimise avamine…", methods: "Muud sisselogimisviisid",
  },
  fa: {
    notCompleted: "ورود کامل نشد. برای تلاش دوباره یک روش ورود انتخاب کنید.",
    title: "وارد شوید یا حساب بسازید",
    google: "ادامه با Google", apple: "ادامه با Apple",
    email: "ادامه با ایمیل", opening: "در حال باز کردن ورود…", methods: "روش‌های دیگر ورود",
  },
  fi: {
    notCompleted: "Kirjautuminen ei valmistunut. Valitse kirjautumistapa ja yritä uudelleen.",
    title: "Kirjaudu sisään tai luo tili",
    google: "Jatka Googlella", apple: "Jatka Applella",
    email: "Jatka sähköpostilla", opening: "Avataan kirjautumista…", methods: "Muut kirjautumistavat",
  },
  gu: {
    notCompleted: "સાઇન ઇન પૂર્ણ થયું નથી. ફરી પ્રયાસ કરવા માટે સાઇન ઇન કરવાની રીત પસંદ કરો.",
    title: "સાઇન ઇન કરો અથવા ખાતું બનાવો",
    google: "Google સાથે ચાલુ રાખો", apple: "Apple સાથે ચાલુ રાખો",
    email: "ઇમેઇલ સાથે ચાલુ રાખો", opening: "સાઇન ઇન ખોલી રહ્યું છે…", methods: "સાઇન ઇન કરવાની અન્ય રીતો",
  },
  he: {
    notCompleted: "הכניסה לא הושלמה. בחרו דרך כניסה כדי לנסות שוב.",
    title: "כניסה או יצירת חשבון",
    google: "המשך עם Google", apple: "המשך עם Apple",
    email: "המשך עם דוא״ל", opening: "פותחים את הכניסה…", methods: "דרכי כניסה אחרות",
  },
  hr: {
    notCompleted: "Prijava nije dovršena. Odaberite način prijave i pokušajte ponovno.",
    title: "Prijavite se ili izradite račun",
    google: "Nastavi s Googleom", apple: "Nastavi s Appleom",
    email: "Nastavi e-poštom", opening: "Otvaranje prijave…", methods: "Drugi načini prijave",
  },
  hu: {
    notCompleted: "A bejelentkezés nem fejeződött be. Válassz bejelentkezési módot az újrapróbálkozáshoz.",
    title: "Jelentkezz be vagy hozz létre fiókot",
    google: "Folytatás Google-fiókkal", apple: "Folytatás Apple-fiókkal",
    email: "Folytatás e-maillel", opening: "Bejelentkezés megnyitása…", methods: "Más bejelentkezési módok",
  },
  id: {
    notCompleted: "Proses masuk belum selesai. Pilih metode masuk untuk mencoba lagi.",
    title: "Masuk atau buat akun",
    google: "Lanjutkan dengan Google", apple: "Lanjutkan dengan Apple",
    email: "Lanjutkan dengan email", opening: "Membuka halaman masuk…", methods: "Metode masuk lainnya",
  },
  is: {
    notCompleted: "Innskráningu var ekki lokið. Veldu innskráningarleið til að reyna aftur.",
    title: "Skráðu þig inn eða stofnaðu aðgang",
    google: "Halda áfram með Google", apple: "Halda áfram með Apple",
    email: "Halda áfram með netfangi", opening: "Opna innskráningu…", methods: "Aðrar innskráningarleiðir",
  },
  it: {
    notCompleted: "L’accesso non è stato completato. Scegli un metodo di accesso per riprovare.",
    title: "Accedi o crea un account",
    google: "Continua con Google", apple: "Continua con Apple",
    email: "Continua con email", opening: "Apertura dell'accesso…", methods: "Altri metodi di accesso",
  },
  kn: {
    notCompleted: "ಸೈನ್ ಇನ್ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು ಸೈನ್ ಇನ್ ವಿಧಾನವನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    title: "ಸೈನ್ ಇನ್ ಮಾಡಿ ಅಥವಾ ಖಾತೆ ರಚಿಸಿ",
    google: "Google ಮೂಲಕ ಮುಂದುವರಿಯಿರಿ", apple: "Apple ಮೂಲಕ ಮುಂದುವರಿಯಿರಿ",
    email: "ಇಮೇಲ್ ಮೂಲಕ ಮುಂದುವರಿಯಿರಿ", opening: "ಸೈನ್ ಇನ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ…", methods: "ಇತರ ಸೈನ್ ಇನ್ ವಿಧಾನಗಳು",
  },
  ko: {
    notCompleted: "로그인이 완료되지 않았습니다. 로그인 방법을 선택하여 다시 시도하세요.",
    title: "로그인 또는 계정 만들기",
    google: "Google로 계속하기", apple: "Apple로 계속하기",
    email: "이메일로 계속하기", opening: "로그인을 여는 중…", methods: "다른 로그인 방법",
  },
  lt: {
    notCompleted: "Prisijungimas nebaigtas. Pasirinkite prisijungimo būdą ir bandykite dar kartą.",
    title: "Prisijunkite arba sukurkite paskyrą",
    google: "Tęsti su Google", apple: "Tęsti su Apple",
    email: "Tęsti el. paštu", opening: "Atidaromas prisijungimas…", methods: "Kiti prisijungimo būdai",
  },
  lv: {
    notCompleted: "Pierakstīšanās netika pabeigta. Izvēlieties pierakstīšanās veidu, lai mēģinātu vēlreiz.",
    title: "Pierakstieties vai izveidojiet kontu",
    google: "Turpināt ar Google", apple: "Turpināt ar Apple",
    email: "Turpināt ar e-pastu", opening: "Atver pierakstīšanos…", methods: "Citi pierakstīšanās veidi",
  },
  ml: {
    notCompleted: "സൈൻ ഇൻ പൂർത്തിയായില്ല. വീണ്ടും ശ്രമിക്കാൻ സൈൻ ഇൻ മാർഗം തിരഞ്ഞെടുക്കുക.",
    title: "സൈൻ ഇൻ ചെയ്യുക അല്ലെങ്കിൽ അക്കൗണ്ട് സൃഷ്ടിക്കുക",
    google: "Google ഉപയോഗിച്ച് തുടരുക", apple: "Apple ഉപയോഗിച്ച് തുടരുക",
    email: "ഇമെയിൽ ഉപയോഗിച്ച് തുടരുക", opening: "സൈൻ ഇൻ തുറക്കുന്നു…", methods: "മറ്റ് സൈൻ ഇൻ മാർഗങ്ങൾ",
  },
  mr: {
    notCompleted: "साइन इन पूर्ण झाले नाही. पुन्हा प्रयत्न करण्यासाठी साइन इन करण्याची पद्धत निवडा.",
    title: "साइन इन करा किंवा खाते तयार करा",
    google: "Google सह पुढे जा", apple: "Apple सह पुढे जा",
    email: "ईमेलने पुढे जा", opening: "साइन इन उघडत आहे…", methods: "साइन इन करण्याचे इतर मार्ग",
  },
  nb: {
    notCompleted: "Innloggingen ble ikke fullført. Velg en innloggingsmetode for å prøve igjen.",
    title: "Logg inn eller opprett en konto",
    google: "Fortsett med Google", apple: "Fortsett med Apple",
    email: "Fortsett med e-post", opening: "Åpner innlogging…", methods: "Andre innloggingsmetoder",
  },
  nl: {
    notCompleted: "Het inloggen is niet voltooid. Kies een inlogmethode om het opnieuw te proberen.",
    title: "Log in of maak een account aan",
    google: "Doorgaan met Google", apple: "Doorgaan met Apple",
    email: "Doorgaan met e-mail", opening: "Inloggen openen…", methods: "Andere inlogmethoden",
  },
  pa: {
    notCompleted: "ਸਾਈਨ ਇਨ ਪੂਰਾ ਨਹੀਂ ਹੋਇਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰਨ ਲਈ ਸਾਈਨ ਇਨ ਕਰਨ ਦਾ ਤਰੀਕਾ ਚੁਣੋ।",
    title: "ਸਾਈਨ ਇਨ ਕਰੋ ਜਾਂ ਖਾਤਾ ਬਣਾਓ",
    google: "Google ਨਾਲ ਜਾਰੀ ਰੱਖੋ", apple: "Apple ਨਾਲ ਜਾਰੀ ਰੱਖੋ",
    email: "ਈਮੇਲ ਨਾਲ ਜਾਰੀ ਰੱਖੋ", opening: "ਸਾਈਨ ਇਨ ਖੋਲ੍ਹਿਆ ਜਾ ਰਿਹਾ ਹੈ…", methods: "ਸਾਈਨ ਇਨ ਕਰਨ ਦੇ ਹੋਰ ਤਰੀਕੇ",
  },
  pl: {
    notCompleted: "Logowanie nie zostało ukończone. Wybierz metodę logowania, aby spróbować ponownie.",
    title: "Zaloguj się lub utwórz konto",
    google: "Kontynuuj z Google", apple: "Kontynuuj z Apple",
    email: "Kontynuuj przez e-mail", opening: "Otwieranie logowania…", methods: "Inne metody logowania",
  },
  ro: {
    notCompleted: "Autentificarea nu s-a finalizat. Alege o metodă de autentificare pentru a încerca din nou.",
    title: "Autentifică-te sau creează un cont",
    google: "Continuă cu Google", apple: "Continuă cu Apple",
    email: "Continuă cu e-mail", opening: "Se deschide autentificarea…", methods: "Alte metode de autentificare",
  },
  sk: {
    notCompleted: "Prihlásenie nebolo dokončené. Vyberte spôsob prihlásenia a skúste to znova.",
    title: "Prihláste sa alebo si vytvorte účet",
    google: "Pokračovať cez Google", apple: "Pokračovať cez Apple",
    email: "Pokračovať e-mailom", opening: "Otváranie prihlásenia…", methods: "Ďalšie spôsoby prihlásenia",
  },
  sl: {
    notCompleted: "Prijava ni bila dokončana. Izberite način prijave in poskusite znova.",
    title: "Prijavite se ali ustvarite račun",
    google: "Nadaljuj z Googlom", apple: "Nadaljuj z Applom",
    email: "Nadaljuj z e-pošto", opening: "Odpiranje prijave…", methods: "Drugi načini prijave",
  },
  sv: {
    notCompleted: "Inloggningen slutfördes inte. Välj en inloggningsmetod för att försöka igen.",
    title: "Logga in eller skapa ett konto",
    google: "Fortsätt med Google", apple: "Fortsätt med Apple",
    email: "Fortsätt med e-post", opening: "Öppnar inloggning…", methods: "Andra inloggningsmetoder",
  },
  sw: {
    notCompleted: "Kuingia hakukukamilika. Chagua njia ya kuingia ili ujaribu tena.",
    title: "Ingia au fungua akaunti",
    google: "Endelea na Google", apple: "Endelea na Apple",
    email: "Endelea kwa barua pepe", opening: "Inafungua kuingia…", methods: "Njia nyingine za kuingia",
  },
  ta: {
    notCompleted: "உள்நுழைவு முடிவடையவில்லை. மீண்டும் முயற்சிக்க உள்நுழைவு முறையைத் தேர்ந்தெடுக்கவும்.",
    title: "உள்நுழையவும் அல்லது கணக்கை உருவாக்கவும்",
    google: "Google மூலம் தொடரவும்", apple: "Apple மூலம் தொடரவும்",
    email: "மின்னஞ்சல் மூலம் தொடரவும்", opening: "உள்நுழைவு திறக்கப்படுகிறது…", methods: "பிற உள்நுழைவு முறைகள்",
  },
  te: {
    notCompleted: "సైన్ ఇన్ పూర్తి కాలేదు. మళ్లీ ప్రయత్నించడానికి సైన్ ఇన్ పద్ధతిని ఎంచుకోండి.",
    title: "సైన్ ఇన్ చేయండి లేదా ఖాతాను సృష్టించండి",
    google: "Googleతో కొనసాగించండి", apple: "Appleతో కొనసాగించండి",
    email: "ఇమెయిల్‌తో కొనసాగించండి", opening: "సైన్ ఇన్ తెరుస్తోంది…", methods: "ఇతర సైన్ ఇన్ పద్ధతులు",
  },
  th: {
    notCompleted: "ลงชื่อเข้าใช้ไม่สำเร็จ โปรดเลือกวิธีลงชื่อเข้าใช้เพื่อลองอีกครั้ง",
    title: "ลงชื่อเข้าใช้หรือสร้างบัญชี",
    google: "ดำเนินการต่อด้วย Google", apple: "ดำเนินการต่อด้วย Apple",
    email: "ดำเนินการต่อด้วยอีเมล", opening: "กำลังเปิดหน้าลงชื่อเข้าใช้…", methods: "วิธีลงชื่อเข้าใช้อื่น",
  },
  tr: {
    notCompleted: "Giriş tamamlanmadı. Yeniden denemek için bir giriş yöntemi seçin.",
    title: "Giriş yapın veya hesap oluşturun",
    google: "Google ile devam et", apple: "Apple ile devam et",
    email: "E-posta ile devam et", opening: "Giriş açılıyor…", methods: "Diğer giriş yöntemleri",
  },
  uk: {
    notCompleted: "Вхід не завершено. Виберіть спосіб входу, щоб спробувати знову.",
    title: "Увійти або створити обліковий запис",
    google: "Продовжити з Google", apple: "Продовжити з Apple",
    email: "Продовжити з поштою", opening: "Відкриваємо вхід…", methods: "Інші способи входу",
  },
  ur: {
    notCompleted: "سائن ان مکمل نہیں ہوا۔ دوبارہ کوشش کرنے کے لیے سائن ان کا طریقہ منتخب کریں۔",
    title: "سائن ان کریں یا اکاؤنٹ بنائیں",
    google: "Google کے ساتھ جاری رکھیں", apple: "Apple کے ساتھ جاری رکھیں",
    email: "ای میل سے جاری رکھیں", opening: "سائن ان کھل رہا ہے…", methods: "سائن ان کے دوسرے طریقے",
  },
  vi: {
    notCompleted: "Đăng nhập chưa hoàn tất. Hãy chọn một cách đăng nhập để thử lại.",
    title: "Đăng nhập hoặc tạo tài khoản",
    google: "Tiếp tục với Google", apple: "Tiếp tục với Apple",
    email: "Tiếp tục bằng email", opening: "Đang mở đăng nhập…", methods: "Cách đăng nhập khác",
  },
  zu: {
    notCompleted: "Ukungena ngemvume akuqedwanga. Khetha indlela yokungena ngemvume ukuze uzame futhi.",
    title: "Ngena ngemvume noma udale i-akhawunti",
    google: "Qhubeka nge-Google", apple: "Qhubeka nge-Apple",
    email: "Qhubeka nge-imeyili", opening: "Kuvulwa ukungena ngemvume…", methods: "Ezinye izindlela zokungena ngemvume",
  },
};
