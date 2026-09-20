import { getLoginPageLocaleDirection, type LoginPageLocale } from "../routes/browser/loginPageLocale.js";

const AUTH_FAVICON_URL =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22512%22%20height=%22512%22%20viewBox=%220%200%20512%20512%22%3E%3Crect%20width=%22512%22%20height=%22512%22%20rx=%2296%22%20fill=%22%23232323%22/%3E%3Crect%20x=%22104%22%20y=%2292%22%20width=%22184%22%20height=%22264%22%20rx=%2232%22%20fill=%22%23f8f3ec%22/%3E%3Crect%20x=%22212%22%20y=%22156%22%20width=%22196%22%20height=%22272%22%20rx=%2232%22%20fill=%22%23c44b2d%22/%3E%3C/svg%3E";

type LoginPageCopy = Readonly<{
  pageTitle: string;
  backToWebsite: string;
  signInTitle: string;
  checkingSession: string;
  emailLabel: string;
  sendCode: string;
  sendingCode: string;
  checkEmailForCode: string;
  verificationCodeLabel: string;
  verify: string;
  verifying: string;
  technicalDetails: string;
  genericErrorPrefix: string;
  sendCodeTransportErrorMessage: string;
  verifyCodeTransportErrorMessage: string;
}>;

const LOGIN_PAGE_COPY: Readonly<Record<LoginPageLocale, LoginPageCopy>> = {
  bg: {
    pageTitle: "Вход",
    backToWebsite: "Назад към сайта",
    signInTitle: "Вход",
    checkingSession: "Проверка на сесията...",
    emailLabel: "Имейл",
    sendCode: "Изпращане на код",
    sendingCode: "Изпращане...",
    checkEmailForCode: "Проверете имейла си за 8-цифрен код. Ако не го виждате, проверете папката за спам.",
    verificationCodeLabel: "Код за потвърждение",
    verify: "Потвърждаване",
    verifying: "Потвърждаване...",
    technicalDetails: "Технически подробности",
    genericErrorPrefix: "Грешка",
    sendCodeTransportErrorMessage: "Не успяхме да потвърдим дали заявката за код е завършила. Проверете имейла си за код и опитайте отново, ако е необходимо.",
    verifyCodeTransportErrorMessage: "Не успяхме да потвърдим дали входът е завършил. Опитайте кода отново или обновете страницата, за да проверите дали вече сте влезли.",
  },
  bn: {
    pageTitle: "সাইন ইন",
    backToWebsite: "ওয়েবসাইটে ফিরে যান",
    signInTitle: "সাইন ইন",
    checkingSession: "সেশন যাচাই করা হচ্ছে...",
    emailLabel: "ইমেইল",
    sendCode: "কোড পাঠান",
    sendingCode: "পাঠানো হচ্ছে...",
    checkEmailForCode: "আপনার ইমেইলে 8 সংখ্যার কোডটি খুঁজুন। না পেলে স্প্যাম ফোল্ডার দেখুন।",
    verificationCodeLabel: "যাচাইকরণ কোড",
    verify: "যাচাই করুন",
    verifying: "যাচাই করা হচ্ছে...",
    technicalDetails: "প্রযুক্তিগত বিবরণ",
    genericErrorPrefix: "ত্রুটি",
    sendCodeTransportErrorMessage: "কোডের অনুরোধটি সম্পূর্ণ হয়েছে কি না আমরা নিশ্চিত করতে পারিনি। ইমেইলে কোড খুঁজুন, তারপর প্রয়োজনে আবার চেষ্টা করুন।",
    verifyCodeTransportErrorMessage: "সাইন ইন সম্পূর্ণ হয়েছে কি না আমরা নিশ্চিত করতে পারিনি। কোডটি আবার ব্যবহার করুন অথবা আপনি ইতিমধ্যে সাইন ইন করেছেন কি না দেখতে পৃষ্ঠাটি রিফ্রেশ করুন।",
  },
  ca: {
    pageTitle: "Inicia la sessió",
    backToWebsite: "Torna al lloc web",
    signInTitle: "Inicia la sessió",
    checkingSession: "S'està comprovant la sessió...",
    emailLabel: "Correu electrònic",
    sendCode: "Envia el codi",
    sendingCode: "S'està enviant...",
    checkEmailForCode: "Busca un codi de 8 dígits al correu electrònic. Si no el veus, comprova la carpeta de correu brossa.",
    verificationCodeLabel: "Codi de verificació",
    verify: "Verifica",
    verifying: "S'està verificant...",
    technicalDetails: "Detalls tècnics",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage: "No hem pogut confirmar si la sol·licitud del codi ha finalitzat. Busca el codi al correu electrònic i torna-ho a provar si cal.",
    verifyCodeTransportErrorMessage: "No hem pogut confirmar si s'ha iniciat la sessió. Torna a provar el codi o actualitza la pàgina per comprovar si ja has iniciat la sessió.",
  },
  cs: {
    pageTitle: "Přihlásit se",
    backToWebsite: "Zpět na web",
    signInTitle: "Přihlásit se",
    checkingSession: "Kontrola relace...",
    emailLabel: "E-mail",
    sendCode: "Odeslat kód",
    sendingCode: "Odesílání...",
    checkEmailForCode: "Vyhledejte v e-mailu 8místný kód. Pokud ho nevidíte, zkontrolujte složku se spamem.",
    verificationCodeLabel: "Ověřovací kód",
    verify: "Ověřit",
    verifying: "Ověřování...",
    technicalDetails: "Technické podrobnosti",
    genericErrorPrefix: "Chyba",
    sendCodeTransportErrorMessage: "Nepodařilo se potvrdit, zda byl požadavek na kód dokončen. Vyhledejte kód v e-mailu a v případě potřeby to zkuste znovu.",
    verifyCodeTransportErrorMessage: "Nepodařilo se potvrdit, zda bylo přihlášení dokončeno. Zkuste kód znovu nebo obnovte stránku a zkontrolujte, zda už jste přihlášeni.",
  },
  da: {
    pageTitle: "Log ind",
    backToWebsite: "Tilbage til hjemmesiden",
    signInTitle: "Log ind",
    checkingSession: "Kontrollerer session...",
    emailLabel: "E-mail",
    sendCode: "Send kode",
    sendingCode: "Sender...",
    checkEmailForCode: "Se efter en 8-cifret kode i din e-mail. Tjek din spammappe, hvis du ikke kan se den.",
    verificationCodeLabel: "Bekræftelseskode",
    verify: "Bekræft",
    verifying: "Bekræfter...",
    technicalDetails: "Tekniske oplysninger",
    genericErrorPrefix: "Fejl",
    sendCodeTransportErrorMessage: "Vi kunne ikke bekræfte, om kodeanmodningen blev gennemført. Se efter en kode i din e-mail, og prøv igen, hvis det er nødvendigt.",
    verifyCodeTransportErrorMessage: "Vi kunne ikke bekræfte, om du blev logget ind. Prøv koden igen, eller opdater siden for at se, om du allerede er logget ind.",
  },
  el: {
    pageTitle: "Σύνδεση",
    backToWebsite: "Επιστροφή στον ιστότοπο",
    signInTitle: "Σύνδεση",
    checkingSession: "Έλεγχος συνεδρίας...",
    emailLabel: "Email",
    sendCode: "Αποστολή κωδικού",
    sendingCode: "Αποστολή...",
    checkEmailForCode: "Ελέγξτε το email σας για έναν 8ψήφιο κωδικό. Αν δεν τον βλέπετε, ελέγξτε τον φάκελο ανεπιθύμητων.",
    verificationCodeLabel: "Κωδικός επαλήθευσης",
    verify: "Επαλήθευση",
    verifying: "Επαλήθευση...",
    technicalDetails: "Τεχνικές λεπτομέρειες",
    genericErrorPrefix: "Σφάλμα",
    sendCodeTransportErrorMessage: "Δεν μπορέσαμε να επιβεβαιώσουμε αν ολοκληρώθηκε το αίτημα για κωδικό. Ελέγξτε το email σας για κωδικό και δοκιμάστε ξανά αν χρειάζεται.",
    verifyCodeTransportErrorMessage: "Δεν μπορέσαμε να επιβεβαιώσουμε αν ολοκληρώθηκε η σύνδεση. Δοκιμάστε ξανά τον κωδικό ή ανανεώστε τη σελίδα για να ελέγξετε αν έχετε ήδη συνδεθεί.",
  },
  et: {
    pageTitle: "Logi sisse",
    backToWebsite: "Tagasi veebilehele",
    signInTitle: "Logi sisse",
    checkingSession: "Seansi kontrollimine...",
    emailLabel: "E-post",
    sendCode: "Saada kood",
    sendingCode: "Saatmine...",
    checkEmailForCode: "Otsi oma e-postist 8-kohalist koodi. Kui sa seda ei leia, kontrolli rämpspostikausta.",
    verificationCodeLabel: "Kinnituskood",
    verify: "Kinnita",
    verifying: "Kinnitamine...",
    technicalDetails: "Tehnilised üksikasjad",
    genericErrorPrefix: "Viga",
    sendCodeTransportErrorMessage: "Me ei saanud kinnitada, kas koodi taotlus lõpetati. Otsi oma e-postist koodi ja proovi vajaduse korral uuesti.",
    verifyCodeTransportErrorMessage: "Me ei saanud kinnitada, kas sisselogimine lõpetati. Proovi koodi uuesti või värskenda lehte, et kontrollida, kas oled juba sisse logitud.",
  },
  fa: {
    pageTitle: "ورود",
    backToWebsite: "بازگشت به وب‌سایت",
    signInTitle: "ورود",
    checkingSession: "در حال بررسی نشست...",
    emailLabel: "ایمیل",
    sendCode: "ارسال کد",
    sendingCode: "در حال ارسال...",
    checkEmailForCode: "کد 8 رقمی را در ایمیل خود پیدا کنید. اگر آن را نمی‌بینید، پوشهٔ هرزنامه را بررسی کنید.",
    verificationCodeLabel: "کد تأیید",
    verify: "تأیید",
    verifying: "در حال تأیید...",
    technicalDetails: "جزئیات فنی",
    genericErrorPrefix: "خطا",
    sendCodeTransportErrorMessage: "نتوانستیم تأیید کنیم که درخواست کد تکمیل شده است یا نه. ایمیل خود را برای یافتن کد بررسی کنید و در صورت نیاز دوباره تلاش کنید.",
    verifyCodeTransportErrorMessage: "نتوانستیم تأیید کنیم که ورود تکمیل شده است یا نه. کد را دوباره امتحان کنید یا صفحه را تازه‌سازی کنید تا ببینید آیا از قبل وارد شده‌اید.",
  },
  fi: {
    pageTitle: "Kirjaudu sisään",
    backToWebsite: "Takaisin verkkosivustolle",
    signInTitle: "Kirjaudu sisään",
    checkingSession: "Tarkistetaan istuntoa...",
    emailLabel: "Sähköposti",
    sendCode: "Lähetä koodi",
    sendingCode: "Lähetetään...",
    checkEmailForCode: "Etsi sähköpostistasi 8-numeroinen koodi. Jos et löydä sitä, tarkista roskapostikansio.",
    verificationCodeLabel: "Vahvistuskoodi",
    verify: "Vahvista",
    verifying: "Vahvistetaan...",
    technicalDetails: "Tekniset tiedot",
    genericErrorPrefix: "Virhe",
    sendCodeTransportErrorMessage: "Emme voineet vahvistaa, valmistuiko koodipyyntö. Etsi koodi sähköpostistasi ja yritä tarvittaessa uudelleen.",
    verifyCodeTransportErrorMessage: "Emme voineet vahvistaa, onnistuiko kirjautuminen. Kokeile koodia uudelleen tai päivitä sivu tarkistaaksesi, oletko jo kirjautunut sisään.",
  },
  gu: {
    pageTitle: "સાઇન ઇન કરો",
    backToWebsite: "વેબસાઇટ પર પાછા જાઓ",
    signInTitle: "સાઇન ઇન કરો",
    checkingSession: "સત્ર તપાસી રહ્યું છે...",
    emailLabel: "ઇમેઇલ",
    sendCode: "કોડ મોકલો",
    sendingCode: "મોકલી રહ્યું છે...",
    checkEmailForCode: "તમારા ઇમેઇલમાં 8 અંકનો કોડ શોધો. જો તે ન દેખાય, તો સ્પામ ફોલ્ડર તપાસો.",
    verificationCodeLabel: "ચકાસણી કોડ",
    verify: "ચકાસો",
    verifying: "ચકાસી રહ્યું છે...",
    technicalDetails: "તકનીકી વિગતો",
    genericErrorPrefix: "ભૂલ",
    sendCodeTransportErrorMessage: "કોડ માટેની વિનંતી પૂર્ણ થઈ છે કે નહીં તેની અમે પુષ્ટિ કરી શક્યા નથી. તમારા ઇમેઇલમાં કોડ શોધો અને જરૂર હોય તો ફરી પ્રયાસ કરો.",
    verifyCodeTransportErrorMessage: "સાઇન ઇન પૂર્ણ થયું છે કે નહીં તેની અમે પુષ્ટિ કરી શક્યા નથી. કોડ ફરી અજમાવો અથવા તમે પહેલેથી સાઇન ઇન કર્યું છે કે નહીં તે તપાસવા પેજ રિફ્રેશ કરો.",
  },
  he: {
    pageTitle: "כניסה",
    backToWebsite: "חזרה לאתר",
    signInTitle: "כניסה",
    checkingSession: "בודקים את ההפעלה...",
    emailLabel: "דוא״ל",
    sendCode: "שליחת קוד",
    sendingCode: "שולחים...",
    checkEmailForCode: "חפשו בדוא״ל קוד בן 8 ספרות. אם אינכם רואים אותו, בדקו את תיקיית הספאם.",
    verificationCodeLabel: "קוד אימות",
    verify: "אימות",
    verifying: "מאמתים...",
    technicalDetails: "פרטים טכניים",
    genericErrorPrefix: "שגיאה",
    sendCodeTransportErrorMessage: "לא הצלחנו לאשר אם בקשת הקוד הושלמה. חפשו קוד בדוא״ל ונסו שוב במידת הצורך.",
    verifyCodeTransportErrorMessage: "לא הצלחנו לאשר אם הכניסה הושלמה. נסו את הקוד שוב או רעננו את הדף כדי לבדוק אם אתם כבר מחוברים.",
  },
  hr: {
    pageTitle: "Prijava",
    backToWebsite: "Natrag na web-stranicu",
    signInTitle: "Prijava",
    checkingSession: "Provjera sesije...",
    emailLabel: "E-pošta",
    sendCode: "Pošalji kod",
    sendingCode: "Slanje...",
    checkEmailForCode: "Potražite 8-znamenkasti kod u svojoj e-pošti. Ako ga ne vidite, provjerite mapu neželjene pošte.",
    verificationCodeLabel: "Kod za potvrdu",
    verify: "Potvrdi",
    verifying: "Potvrđivanje...",
    technicalDetails: "Tehnički detalji",
    genericErrorPrefix: "Pogreška",
    sendCodeTransportErrorMessage: "Nismo mogli potvrditi je li zahtjev za kod dovršen. Potražite kod u e-pošti pa po potrebi pokušajte ponovno.",
    verifyCodeTransportErrorMessage: "Nismo mogli potvrditi je li prijava dovršena. Pokušajte ponovno s kodom ili osvježite stranicu da provjerite jeste li već prijavljeni.",
  },
  hu: {
    pageTitle: "Bejelentkezés",
    backToWebsite: "Vissza a webhelyre",
    signInTitle: "Bejelentkezés",
    checkingSession: "Munkamenet ellenőrzése...",
    emailLabel: "E-mail",
    sendCode: "Kód küldése",
    sendingCode: "Küldés...",
    checkEmailForCode: "Keresse meg a 8 számjegyű kódot az e-mailjei között. Ha nem találja, nézze meg a spam mappát.",
    verificationCodeLabel: "Ellenőrző kód",
    verify: "Ellenőrzés",
    verifying: "Ellenőrzés...",
    technicalDetails: "Technikai részletek",
    genericErrorPrefix: "Hiba",
    sendCodeTransportErrorMessage: "Nem tudtuk megerősíteni, hogy a kódkérés befejeződött-e. Keresse meg a kódot az e-mailjei között, majd szükség esetén próbálja újra.",
    verifyCodeTransportErrorMessage: "Nem tudtuk megerősíteni, hogy a bejelentkezés befejeződött-e. Próbálja újra a kódot, vagy frissítse az oldalt, hogy ellenőrizze, be van-e már jelentkezve.",
  },
  id: {
    pageTitle: "Masuk",
    backToWebsite: "Kembali ke situs web",
    signInTitle: "Masuk",
    checkingSession: "Memeriksa sesi...",
    emailLabel: "Email",
    sendCode: "Kirim kode",
    sendingCode: "Mengirim...",
    checkEmailForCode: "Cari kode 8 digit di email Anda. Jika tidak ada, periksa folder spam.",
    verificationCodeLabel: "Kode verifikasi",
    verify: "Verifikasi",
    verifying: "Memverifikasi...",
    technicalDetails: "Detail teknis",
    genericErrorPrefix: "Kesalahan",
    sendCodeTransportErrorMessage: "Kami tidak dapat memastikan apakah permintaan kode sudah selesai. Cari kode di email Anda, lalu coba lagi jika perlu.",
    verifyCodeTransportErrorMessage: "Kami tidak dapat memastikan apakah proses masuk sudah selesai. Coba kode lagi atau muat ulang halaman untuk memeriksa apakah Anda sudah masuk.",
  },
  is: {
    pageTitle: "Skrá inn",
    backToWebsite: "Til baka á vefsvæðið",
    signInTitle: "Skrá inn",
    checkingSession: "Athuga setu...",
    emailLabel: "Netfang",
    sendCode: "Senda kóða",
    sendingCode: "Sendi...",
    checkEmailForCode: "Leitaðu að 8 stafa tölukóða í tölvupóstinum þínum. Ef þú sérð hann ekki skaltu athuga ruslpóstmöppuna.",
    verificationCodeLabel: "Staðfestingarkóði",
    verify: "Staðfesta",
    verifying: "Staðfesti...",
    technicalDetails: "Tæknilegar upplýsingar",
    genericErrorPrefix: "Villa",
    sendCodeTransportErrorMessage: "Ekki tókst að staðfesta hvort beiðninni um kóða var lokið. Leitaðu að kóða í tölvupóstinum þínum og reyndu aftur ef þörf krefur.",
    verifyCodeTransportErrorMessage: "Ekki tókst að staðfesta hvort innskráningu var lokið. Prófaðu kóðann aftur eða endurhladdu síðuna til að athuga hvort þú sért þegar skráð(ur) inn.",
  },
  it: {
    pageTitle: "Accedi",
    backToWebsite: "Torna al sito",
    signInTitle: "Accedi",
    checkingSession: "Verifica della sessione...",
    emailLabel: "Email",
    sendCode: "Invia codice",
    sendingCode: "Invio...",
    checkEmailForCode: "Cerca nella tua email un codice di 8 cifre. Se non lo trovi, controlla la cartella spam.",
    verificationCodeLabel: "Codice di verifica",
    verify: "Verifica",
    verifying: "Verifica in corso...",
    technicalDetails: "Dettagli tecnici",
    genericErrorPrefix: "Errore",
    sendCodeTransportErrorMessage: "Non siamo riusciti a confermare se la richiesta del codice è stata completata. Cerca il codice nella tua email e riprova se necessario.",
    verifyCodeTransportErrorMessage: "Non siamo riusciti a confermare se l'accesso è stato completato. Riprova il codice o aggiorna la pagina per verificare se hai già effettuato l'accesso.",
  },
  kn: {
    pageTitle: "ಸೈನ್ ಇನ್ ಮಾಡಿ",
    backToWebsite: "ವೆಬ್‌ಸೈಟ್‌ಗೆ ಹಿಂತಿರುಗಿ",
    signInTitle: "ಸೈನ್ ಇನ್ ಮಾಡಿ",
    checkingSession: "ಸೆಷನ್ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...",
    emailLabel: "ಇಮೇಲ್",
    sendCode: "ಕೋಡ್ ಕಳುಹಿಸಿ",
    sendingCode: "ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...",
    checkEmailForCode: "ನಿಮ್ಮ ಇಮೇಲ್‌ನಲ್ಲಿ 8 ಅಂಕಿಗಳ ಕೋಡ್ ಹುಡುಕಿ. ಅದು ಕಾಣದಿದ್ದರೆ, ಸ್ಪ್ಯಾಮ್ ಫೋಲ್ಡರ್ ಪರಿಶೀಲಿಸಿ.",
    verificationCodeLabel: "ಪರಿಶೀಲನಾ ಕೋಡ್",
    verify: "ಪರಿಶೀಲಿಸಿ",
    verifying: "ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...",
    technicalDetails: "ತಾಂತ್ರಿಕ ವಿವರಗಳು",
    genericErrorPrefix: "ದೋಷ",
    sendCodeTransportErrorMessage: "ಕೋಡ್ ವಿನಂತಿ ಪೂರ್ಣಗೊಂಡಿದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಲು ನಮಗೆ ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಇಮೇಲ್‌ನಲ್ಲಿ ಕೋಡ್ ಹುಡುಕಿ, ನಂತರ ಅಗತ್ಯವಿದ್ದರೆ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    verifyCodeTransportErrorMessage: "ಸೈನ್ ಇನ್ ಪೂರ್ಣಗೊಂಡಿದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಲು ನಮಗೆ ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಕೋಡ್ ಅನ್ನು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ನೀವು ಈಗಾಗಲೇ ಸೈನ್ ಇನ್ ಮಾಡಿದ್ದೀರಾ ಎಂದು ಪರಿಶೀಲಿಸಲು ಪುಟವನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ.",
  },
  ko: {
    pageTitle: "로그인",
    backToWebsite: "웹사이트로 돌아가기",
    signInTitle: "로그인",
    checkingSession: "세션 확인 중...",
    emailLabel: "이메일",
    sendCode: "코드 보내기",
    sendingCode: "전송 중...",
    checkEmailForCode: "이메일에서 8자리 코드를 확인하세요. 보이지 않으면 스팸 폴더를 확인하세요.",
    verificationCodeLabel: "인증 코드",
    verify: "인증",
    verifying: "인증 중...",
    technicalDetails: "기술 세부 정보",
    genericErrorPrefix: "오류",
    sendCodeTransportErrorMessage: "코드 요청이 완료되었는지 확인할 수 없습니다. 이메일에서 코드를 확인한 후 필요하면 다시 시도하세요.",
    verifyCodeTransportErrorMessage: "로그인이 완료되었는지 확인할 수 없습니다. 코드를 다시 입력하거나 페이지를 새로고침하여 이미 로그인되어 있는지 확인하세요.",
  },
  lt: {
    pageTitle: "Prisijungti",
    backToWebsite: "Grįžti į svetainę",
    signInTitle: "Prisijungti",
    checkingSession: "Tikrinamas seansas...",
    emailLabel: "El. paštas",
    sendCode: "Siųsti kodą",
    sendingCode: "Siunčiama...",
    checkEmailForCode: "El. pašte ieškokite 8 skaitmenų kodo. Jei jo nematote, patikrinkite šlamšto aplanką.",
    verificationCodeLabel: "Patvirtinimo kodas",
    verify: "Patvirtinti",
    verifying: "Patvirtinama...",
    technicalDetails: "Techninė informacija",
    genericErrorPrefix: "Klaida",
    sendCodeTransportErrorMessage: "Nepavyko patvirtinti, ar kodo užklausa baigta. El. pašte ieškokite kodo ir, jei reikia, bandykite dar kartą.",
    verifyCodeTransportErrorMessage: "Nepavyko patvirtinti, ar prisijungimas baigtas. Dar kartą įveskite kodą arba atnaujinkite puslapį ir patikrinkite, ar jau prisijungėte.",
  },
  lv: {
    pageTitle: "Pierakstīties",
    backToWebsite: "Atpakaļ uz vietni",
    signInTitle: "Pierakstīties",
    checkingSession: "Notiek sesijas pārbaude...",
    emailLabel: "E-pasts",
    sendCode: "Nosūtīt kodu",
    sendingCode: "Notiek sūtīšana...",
    checkEmailForCode: "Meklējiet e-pastā 8 ciparu kodu. Ja to neredzat, pārbaudiet surogātpasta mapi.",
    verificationCodeLabel: "Verifikācijas kods",
    verify: "Verificēt",
    verifying: "Notiek verifikācija...",
    technicalDetails: "Tehniskā informācija",
    genericErrorPrefix: "Kļūda",
    sendCodeTransportErrorMessage: "Neizdevās apstiprināt, vai koda pieprasījums tika pabeigts. Meklējiet kodu e-pastā un, ja nepieciešams, mēģiniet vēlreiz.",
    verifyCodeTransportErrorMessage: "Neizdevās apstiprināt, vai pierakstīšanās tika pabeigta. Mēģiniet ievadīt kodu vēlreiz vai atsvaidziniet lapu, lai pārbaudītu, vai jau esat pierakstījies.",
  },
  ml: {
    pageTitle: "സൈൻ ഇൻ ചെയ്യുക",
    backToWebsite: "വെബ്‌സൈറ്റിലേക്ക് മടങ്ങുക",
    signInTitle: "സൈൻ ഇൻ ചെയ്യുക",
    checkingSession: "സെഷൻ പരിശോധിക്കുന്നു...",
    emailLabel: "ഇമെയിൽ",
    sendCode: "കോഡ് അയയ്ക്കുക",
    sendingCode: "അയയ്ക്കുന്നു...",
    checkEmailForCode: "നിങ്ങളുടെ ഇമെയിലിൽ 8 അക്ക കോഡ് നോക്കുക. കാണുന്നില്ലെങ്കിൽ സ്പാം ഫോൾഡർ പരിശോധിക്കുക.",
    verificationCodeLabel: "സ്ഥിരീകരണ കോഡ്",
    verify: "സ്ഥിരീകരിക്കുക",
    verifying: "സ്ഥിരീകരിക്കുന്നു...",
    technicalDetails: "സാങ്കേതിക വിശദാംശങ്ങൾ",
    genericErrorPrefix: "പിശക്",
    sendCodeTransportErrorMessage: "കോഡിനായുള്ള അഭ്യർത്ഥന പൂർത്തിയായോ എന്ന് സ്ഥിരീകരിക്കാനായില്ല. ഇമെയിലിൽ കോഡ് നോക്കുക, ആവശ്യമെങ്കിൽ വീണ്ടും ശ്രമിക്കുക.",
    verifyCodeTransportErrorMessage: "സൈൻ ഇൻ പൂർത്തിയായോ എന്ന് സ്ഥിരീകരിക്കാനായില്ല. കോഡ് വീണ്ടും ശ്രമിക്കുക, അല്ലെങ്കിൽ ഇതിനകം സൈൻ ഇൻ ചെയ്തിട്ടുണ്ടോ എന്ന് പരിശോധിക്കാൻ പേജ് പുതുക്കുക.",
  },
  mr: {
    pageTitle: "साइन इन करा",
    backToWebsite: "वेबसाइटवर परत जा",
    signInTitle: "साइन इन करा",
    checkingSession: "सत्र तपासत आहे...",
    emailLabel: "ईमेल",
    sendCode: "कोड पाठवा",
    sendingCode: "पाठवत आहे...",
    checkEmailForCode: "तुमच्या ईमेलमध्ये 8 अंकी कोड शोधा. तो दिसत नसल्यास स्पॅम फोल्डर तपासा.",
    verificationCodeLabel: "पडताळणी कोड",
    verify: "पडताळा",
    verifying: "पडताळत आहे...",
    technicalDetails: "तांत्रिक तपशील",
    genericErrorPrefix: "त्रुटी",
    sendCodeTransportErrorMessage: "कोडची विनंती पूर्ण झाली आहे की नाही याची पुष्टी आम्हाला करता आली नाही. ईमेलमध्ये कोड शोधा आणि गरज असल्यास पुन्हा प्रयत्न करा.",
    verifyCodeTransportErrorMessage: "साइन इन पूर्ण झाले आहे की नाही याची पुष्टी आम्हाला करता आली नाही. कोड पुन्हा वापरून पाहा किंवा तुम्ही आधीच साइन इन केले आहे का हे तपासण्यासाठी पेज रिफ्रेश करा.",
  },
  nb: {
    pageTitle: "Logg inn",
    backToWebsite: "Tilbake til nettstedet",
    signInTitle: "Logg inn",
    checkingSession: "Kontrollerer økten...",
    emailLabel: "E-post",
    sendCode: "Send kode",
    sendingCode: "Sender...",
    checkEmailForCode: "Se etter en 8-sifret kode i e-posten din. Sjekk søppelpostmappen hvis du ikke finner den.",
    verificationCodeLabel: "Bekreftelseskode",
    verify: "Bekreft",
    verifying: "Bekrefter...",
    technicalDetails: "Tekniske detaljer",
    genericErrorPrefix: "Feil",
    sendCodeTransportErrorMessage: "Vi kunne ikke bekrefte om kodeforespørselen ble fullført. Se etter en kode i e-posten din, og prøv igjen om nødvendig.",
    verifyCodeTransportErrorMessage: "Vi kunne ikke bekrefte om innloggingen ble fullført. Prøv koden igjen, eller oppdater siden for å se om du allerede er logget inn.",
  },
  nl: {
    pageTitle: "Inloggen",
    backToWebsite: "Terug naar de website",
    signInTitle: "Inloggen",
    checkingSession: "Sessie controleren...",
    emailLabel: "E-mail",
    sendCode: "Code verzenden",
    sendingCode: "Verzenden...",
    checkEmailForCode: "Zoek in je e-mail naar een code van 8 cijfers. Controleer je spammap als je de code niet ziet.",
    verificationCodeLabel: "Verificatiecode",
    verify: "Verifiëren",
    verifying: "Verifiëren...",
    technicalDetails: "Technische details",
    genericErrorPrefix: "Fout",
    sendCodeTransportErrorMessage: "We konden niet bevestigen of het codeverzoek is voltooid. Zoek in je e-mail naar een code en probeer het zo nodig opnieuw.",
    verifyCodeTransportErrorMessage: "We konden niet bevestigen of het inloggen is voltooid. Probeer de code opnieuw of vernieuw de pagina om te controleren of je al bent ingelogd.",
  },
  pa: {
    pageTitle: "ਸਾਈਨ ਇਨ ਕਰੋ",
    backToWebsite: "ਵੈੱਬਸਾਈਟ 'ਤੇ ਵਾਪਸ ਜਾਓ",
    signInTitle: "ਸਾਈਨ ਇਨ ਕਰੋ",
    checkingSession: "ਸੈਸ਼ਨ ਦੀ ਜਾਂਚ ਹੋ ਰਹੀ ਹੈ...",
    emailLabel: "ਈਮੇਲ",
    sendCode: "ਕੋਡ ਭੇਜੋ",
    sendingCode: "ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ...",
    checkEmailForCode: "ਆਪਣੀ ਈਮੇਲ ਵਿੱਚ 8 ਅੰਕਾਂ ਦਾ ਕੋਡ ਲੱਭੋ। ਜੇ ਨਹੀਂ ਦਿਸਦਾ, ਤਾਂ ਸਪੈਮ ਫੋਲਡਰ ਦੇਖੋ।",
    verificationCodeLabel: "ਪੁਸ਼ਟੀਕਰਨ ਕੋਡ",
    verify: "ਪੁਸ਼ਟੀ ਕਰੋ",
    verifying: "ਪੁਸ਼ਟੀ ਹੋ ਰਹੀ ਹੈ...",
    technicalDetails: "ਤਕਨੀਕੀ ਵੇਰਵੇ",
    genericErrorPrefix: "ਗਲਤੀ",
    sendCodeTransportErrorMessage: "ਅਸੀਂ ਪੁਸ਼ਟੀ ਨਹੀਂ ਕਰ ਸਕੇ ਕਿ ਕੋਡ ਦੀ ਬੇਨਤੀ ਪੂਰੀ ਹੋਈ ਹੈ ਜਾਂ ਨਹੀਂ। ਆਪਣੀ ਈਮੇਲ ਵਿੱਚ ਕੋਡ ਲੱਭੋ ਅਤੇ ਲੋੜ ਪੈਣ 'ਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
    verifyCodeTransportErrorMessage: "ਅਸੀਂ ਪੁਸ਼ਟੀ ਨਹੀਂ ਕਰ ਸਕੇ ਕਿ ਸਾਈਨ ਇਨ ਪੂਰਾ ਹੋਇਆ ਹੈ ਜਾਂ ਨਹੀਂ। ਕੋਡ ਦੁਬਾਰਾ ਅਜ਼ਮਾਓ ਜਾਂ ਇਹ ਦੇਖਣ ਲਈ ਪੰਨਾ ਰਿਫ੍ਰੈਸ਼ ਕਰੋ ਕਿ ਤੁਸੀਂ ਪਹਿਲਾਂ ਹੀ ਸਾਈਨ ਇਨ ਕੀਤਾ ਹੈ ਜਾਂ ਨਹੀਂ।",
  },
  pl: {
    pageTitle: "Zaloguj się",
    backToWebsite: "Powrót do witryny",
    signInTitle: "Zaloguj się",
    checkingSession: "Sprawdzanie sesji...",
    emailLabel: "E-mail",
    sendCode: "Wyślij kod",
    sendingCode: "Wysyłanie...",
    checkEmailForCode: "Poszukaj w poczcie e-mail 8-cyfrowego kodu. Jeśli go nie widzisz, sprawdź folder ze spamem.",
    verificationCodeLabel: "Kod weryfikacyjny",
    verify: "Zweryfikuj",
    verifying: "Weryfikowanie...",
    technicalDetails: "Szczegóły techniczne",
    genericErrorPrefix: "Błąd",
    sendCodeTransportErrorMessage: "Nie udało się potwierdzić, czy żądanie kodu zostało zakończone. Poszukaj kodu w poczcie e-mail i w razie potrzeby spróbuj ponownie.",
    verifyCodeTransportErrorMessage: "Nie udało się potwierdzić, czy logowanie zostało zakończone. Spróbuj ponownie użyć kodu lub odśwież stronę, aby sprawdzić, czy jesteś już zalogowany.",
  },
  ro: {
    pageTitle: "Autentificare",
    backToWebsite: "Înapoi la site",
    signInTitle: "Autentificare",
    checkingSession: "Se verifică sesiunea...",
    emailLabel: "E-mail",
    sendCode: "Trimite codul",
    sendingCode: "Se trimite...",
    checkEmailForCode: "Caută în e-mail un cod din 8 cifre. Dacă nu îl găsești, verifică dosarul de spam.",
    verificationCodeLabel: "Cod de verificare",
    verify: "Verifică",
    verifying: "Se verifică...",
    technicalDetails: "Detalii tehnice",
    genericErrorPrefix: "Eroare",
    sendCodeTransportErrorMessage: "Nu am putut confirma dacă solicitarea codului s-a încheiat. Caută codul în e-mail, apoi încearcă din nou dacă este necesar.",
    verifyCodeTransportErrorMessage: "Nu am putut confirma dacă autentificarea s-a încheiat. Încearcă din nou codul sau reîncarcă pagina pentru a verifica dacă ești deja autentificat.",
  },
  sk: {
    pageTitle: "Prihlásiť sa",
    backToWebsite: "Späť na web",
    signInTitle: "Prihlásiť sa",
    checkingSession: "Kontrola relácie...",
    emailLabel: "E-mail",
    sendCode: "Odoslať kód",
    sendingCode: "Odosielanie...",
    checkEmailForCode: "Vyhľadajte v e-maile 8-miestny kód. Ak ho nevidíte, skontrolujte priečinok so spamom.",
    verificationCodeLabel: "Overovací kód",
    verify: "Overiť",
    verifying: "Overovanie...",
    technicalDetails: "Technické podrobnosti",
    genericErrorPrefix: "Chyba",
    sendCodeTransportErrorMessage: "Nepodarilo sa potvrdiť, či bola žiadosť o kód dokončená. Vyhľadajte kód v e-maile a v prípade potreby to skúste znova.",
    verifyCodeTransportErrorMessage: "Nepodarilo sa potvrdiť, či bolo prihlásenie dokončené. Skúste kód znova alebo obnovte stránku a overte, či už ste prihlásení.",
  },
  sl: {
    pageTitle: "Prijava",
    backToWebsite: "Nazaj na spletno mesto",
    signInTitle: "Prijava",
    checkingSession: "Preverjanje seje...",
    emailLabel: "E-pošta",
    sendCode: "Pošlji kodo",
    sendingCode: "Pošiljanje...",
    checkEmailForCode: "V e-pošti poiščite 8-mestno kodo. Če je ne vidite, preverite mapo z neželeno pošto.",
    verificationCodeLabel: "Potrditvena koda",
    verify: "Potrdi",
    verifying: "Potrjevanje...",
    technicalDetails: "Tehnične podrobnosti",
    genericErrorPrefix: "Napaka",
    sendCodeTransportErrorMessage: "Nismo mogli potrditi, ali je bila zahteva za kodo dokončana. V e-pošti poiščite kodo in po potrebi poskusite znova.",
    verifyCodeTransportErrorMessage: "Nismo mogli potrditi, ali je bila prijava dokončana. Znova poskusite s kodo ali osvežite stran, da preverite, ali ste že prijavljeni.",
  },
  sv: {
    pageTitle: "Logga in",
    backToWebsite: "Tillbaka till webbplatsen",
    signInTitle: "Logga in",
    checkingSession: "Kontrollerar session...",
    emailLabel: "E-post",
    sendCode: "Skicka kod",
    sendingCode: "Skickar...",
    checkEmailForCode: "Leta efter en 8-siffrig kod i din e-post. Kontrollera skräppostmappen om du inte hittar den.",
    verificationCodeLabel: "Verifieringskod",
    verify: "Verifiera",
    verifying: "Verifierar...",
    technicalDetails: "Tekniska detaljer",
    genericErrorPrefix: "Fel",
    sendCodeTransportErrorMessage: "Vi kunde inte bekräfta om kodbegäran slutfördes. Leta efter en kod i din e-post och försök igen vid behov.",
    verifyCodeTransportErrorMessage: "Vi kunde inte bekräfta om inloggningen slutfördes. Prova koden igen eller uppdatera sidan för att se om du redan är inloggad.",
  },
  sw: {
    pageTitle: "Ingia",
    backToWebsite: "Rudi kwenye tovuti",
    signInTitle: "Ingia",
    checkingSession: "Inakagua kipindi...",
    emailLabel: "Barua pepe",
    sendCode: "Tuma msimbo",
    sendingCode: "Inatuma...",
    checkEmailForCode: "Tafuta msimbo wa tarakimu 8 kwenye barua pepe yako. Usipouona, angalia folda ya barua taka.",
    verificationCodeLabel: "Msimbo wa uthibitishaji",
    verify: "Thibitisha",
    verifying: "Inathibitisha...",
    technicalDetails: "Maelezo ya kiufundi",
    genericErrorPrefix: "Hitilafu",
    sendCodeTransportErrorMessage: "Hatukuweza kuthibitisha kama ombi la msimbo limekamilika. Tafuta msimbo kwenye barua pepe yako, kisha ujaribu tena ikihitajika.",
    verifyCodeTransportErrorMessage: "Hatukuweza kuthibitisha kama kuingia kumekamilika. Jaribu msimbo tena au pakia ukurasa upya ili uangalie kama tayari umeingia.",
  },
  ta: {
    pageTitle: "உள்நுழையவும்",
    backToWebsite: "இணையதளத்திற்குத் திரும்பவும்",
    signInTitle: "உள்நுழையவும்",
    checkingSession: "அமர்வைச் சரிபார்க்கிறது...",
    emailLabel: "மின்னஞ்சல்",
    sendCode: "குறியீட்டை அனுப்பவும்",
    sendingCode: "அனுப்புகிறது...",
    checkEmailForCode: "உங்கள் மின்னஞ்சலில் 8 இலக்கக் குறியீட்டைத் தேடுங்கள். அது தெரியவில்லை என்றால், ஸ்பேம் கோப்புறையைச் சரிபார்க்கவும்.",
    verificationCodeLabel: "சரிபார்ப்புக் குறியீடு",
    verify: "சரிபார்க்கவும்",
    verifying: "சரிபார்க்கிறது...",
    technicalDetails: "தொழில்நுட்ப விவரங்கள்",
    genericErrorPrefix: "பிழை",
    sendCodeTransportErrorMessage: "குறியீட்டிற்கான கோரிக்கை முடிந்ததா என்பதை எங்களால் உறுதிப்படுத்த முடியவில்லை. உங்கள் மின்னஞ்சலில் குறியீட்டைத் தேடுங்கள்; தேவைப்பட்டால் மீண்டும் முயலவும்.",
    verifyCodeTransportErrorMessage: "உள்நுழைவு முடிந்ததா என்பதை எங்களால் உறுதிப்படுத்த முடியவில்லை. குறியீட்டை மீண்டும் முயலவும் அல்லது நீங்கள் ஏற்கனவே உள்நுழைந்துள்ளீர்களா என்பதைச் சரிபார்க்கப் பக்கத்தைப் புதுப்பிக்கவும்.",
  },
  te: {
    pageTitle: "సైన్ ఇన్ చేయండి",
    backToWebsite: "వెబ్‌సైట్‌కు తిరిగి వెళ్లండి",
    signInTitle: "సైన్ ఇన్ చేయండి",
    checkingSession: "సెషన్‌ను తనిఖీ చేస్తోంది...",
    emailLabel: "ఇమెయిల్",
    sendCode: "కోడ్ పంపండి",
    sendingCode: "పంపుతోంది...",
    checkEmailForCode: "మీ ఇమెయిల్‌లో 8 అంకెల కోడ్ కోసం చూడండి. అది కనిపించకపోతే, స్పామ్ ఫోల్డర్‌ను తనిఖీ చేయండి.",
    verificationCodeLabel: "ధృవీకరణ కోడ్",
    verify: "ధృవీకరించండి",
    verifying: "ధృవీకరిస్తోంది...",
    technicalDetails: "సాంకేతిక వివరాలు",
    genericErrorPrefix: "లోపం",
    sendCodeTransportErrorMessage: "కోడ్ అభ్యర్థన పూర్తయిందో లేదో మేము నిర్ధారించలేకపోయాము. మీ ఇమెయిల్‌లో కోడ్ కోసం చూడండి, అవసరమైతే మళ్లీ ప్రయత్నించండి.",
    verifyCodeTransportErrorMessage: "సైన్ ఇన్ పూర్తయిందో లేదో మేము నిర్ధారించలేకపోయాము. కోడ్‌ను మళ్లీ ప్రయత్నించండి లేదా మీరు ఇప్పటికే సైన్ ఇన్ చేశారో లేదో తనిఖీ చేయడానికి పేజీని రిఫ్రెష్ చేయండి.",
  },
  th: {
    pageTitle: "ลงชื่อเข้าใช้",
    backToWebsite: "กลับไปที่เว็บไซต์",
    signInTitle: "ลงชื่อเข้าใช้",
    checkingSession: "กำลังตรวจสอบเซสชัน...",
    emailLabel: "อีเมล",
    sendCode: "ส่งรหัส",
    sendingCode: "กำลังส่ง...",
    checkEmailForCode: "ค้นหารหัส 8 หลักในอีเมลของคุณ หากไม่พบ โปรดตรวจสอบโฟลเดอร์สแปม",
    verificationCodeLabel: "รหัสยืนยัน",
    verify: "ยืนยัน",
    verifying: "กำลังยืนยัน...",
    technicalDetails: "รายละเอียดทางเทคนิค",
    genericErrorPrefix: "ข้อผิดพลาด",
    sendCodeTransportErrorMessage: "เราไม่สามารถยืนยันได้ว่าคำขอรหัสเสร็จสมบูรณ์แล้วหรือไม่ โปรดตรวจสอบรหัสในอีเมล แล้วลองอีกครั้งหากจำเป็น",
    verifyCodeTransportErrorMessage: "เราไม่สามารถยืนยันได้ว่าการลงชื่อเข้าใช้เสร็จสมบูรณ์แล้วหรือไม่ โปรดลองใช้รหัสอีกครั้ง หรือรีเฟรชหน้าเพื่อตรวจสอบว่าคุณลงชื่อเข้าใช้แล้วหรือยัง",
  },
  tr: {
    pageTitle: "Giriş yap",
    backToWebsite: "Web sitesine dön",
    signInTitle: "Giriş yap",
    checkingSession: "Oturum kontrol ediliyor...",
    emailLabel: "E-posta",
    sendCode: "Kod gönder",
    sendingCode: "Gönderiliyor...",
    checkEmailForCode: "E-postanızda 8 haneli kodu arayın. Göremiyorsanız spam klasörünü kontrol edin.",
    verificationCodeLabel: "Doğrulama kodu",
    verify: "Doğrula",
    verifying: "Doğrulanıyor...",
    technicalDetails: "Teknik ayrıntılar",
    genericErrorPrefix: "Hata",
    sendCodeTransportErrorMessage: "Kod isteğinin tamamlanıp tamamlanmadığını doğrulayamadık. E-postanızda kodu arayın, ardından gerekirse tekrar deneyin.",
    verifyCodeTransportErrorMessage: "Giriş işleminin tamamlanıp tamamlanmadığını doğrulayamadık. Kodu tekrar deneyin veya zaten giriş yapıp yapmadığınızı kontrol etmek için sayfayı yenileyin.",
  },
  uk: {
    pageTitle: "Увійти",
    backToWebsite: "Повернутися на сайт",
    signInTitle: "Увійти",
    checkingSession: "Перевірка сеансу...",
    emailLabel: "Електронна пошта",
    sendCode: "Надіслати код",
    sendingCode: "Надсилання...",
    checkEmailForCode: "Перевірте пошту: там має бути 8-значний код. Якщо його немає, перевірте папку «Спам».",
    verificationCodeLabel: "Код підтвердження",
    verify: "Підтвердити",
    verifying: "Перевірка...",
    technicalDetails: "Технічні подробиці",
    genericErrorPrefix: "Помилка",
    sendCodeTransportErrorMessage: "Не вдалося підтвердити, чи завершився запит коду. Перевірте пошту на наявність коду, а потім за потреби спробуйте ще раз.",
    verifyCodeTransportErrorMessage: "Не вдалося підтвердити, чи завершився вхід. Спробуйте код ще раз або оновіть сторінку, щоб перевірити, чи ви вже ввійшли.",
  },
  ur: {
    pageTitle: "سائن ان کریں",
    backToWebsite: "ویب سائٹ پر واپس جائیں",
    signInTitle: "سائن ان کریں",
    checkingSession: "سیشن کی جانچ ہو رہی ہے...",
    emailLabel: "ای میل",
    sendCode: "کوڈ بھیجیں",
    sendingCode: "بھیجا جا رہا ہے...",
    checkEmailForCode: "اپنی ای میل میں 8 ہندسوں کا کوڈ تلاش کریں۔ اگر نظر نہ آئے تو اسپیم فولڈر دیکھیں۔",
    verificationCodeLabel: "تصدیقی کوڈ",
    verify: "تصدیق کریں",
    verifying: "تصدیق ہو رہی ہے...",
    technicalDetails: "تکنیکی تفصیلات",
    genericErrorPrefix: "خرابی",
    sendCodeTransportErrorMessage: "ہم تصدیق نہیں کر سکے کہ کوڈ کی درخواست مکمل ہوئی ہے یا نہیں۔ اپنی ای میل میں کوڈ تلاش کریں اور ضرورت ہو تو دوبارہ کوشش کریں۔",
    verifyCodeTransportErrorMessage: "ہم تصدیق نہیں کر سکے کہ سائن ان مکمل ہوا ہے یا نہیں۔ کوڈ دوبارہ آزمائیں یا صفحہ ریفریش کر کے دیکھیں کہ آپ پہلے ہی سائن ان ہیں یا نہیں۔",
  },
  vi: {
    pageTitle: "Đăng nhập",
    backToWebsite: "Quay lại trang web",
    signInTitle: "Đăng nhập",
    checkingSession: "Đang kiểm tra phiên...",
    emailLabel: "Email",
    sendCode: "Gửi mã",
    sendingCode: "Đang gửi...",
    checkEmailForCode: "Tìm mã gồm 8 chữ số trong email của bạn. Nếu không thấy, hãy kiểm tra thư mục thư rác.",
    verificationCodeLabel: "Mã xác minh",
    verify: "Xác minh",
    verifying: "Đang xác minh...",
    technicalDetails: "Chi tiết kỹ thuật",
    genericErrorPrefix: "Lỗi",
    sendCodeTransportErrorMessage: "Chúng tôi không thể xác nhận yêu cầu mã đã hoàn tất hay chưa. Hãy tìm mã trong email, rồi thử lại nếu cần.",
    verifyCodeTransportErrorMessage: "Chúng tôi không thể xác nhận việc đăng nhập đã hoàn tất hay chưa. Hãy thử lại mã hoặc tải lại trang để kiểm tra xem bạn đã đăng nhập chưa.",
  },
  zu: {
    pageTitle: "Ngena ngemvume",
    backToWebsite: "Buyela kuwebhusayithi",
    signInTitle: "Ngena ngemvume",
    checkingSession: "Kuhlolwa iseshini...",
    emailLabel: "I-imeyili",
    sendCode: "Thumela ikhodi",
    sendingCode: "Iyathumela...",
    checkEmailForCode: "Bheka ikhodi enezinombolo ezingu-8 ku-imeyili yakho. Uma ungayiboni, hlola ifolda yogaxekile.",
    verificationCodeLabel: "Ikhodi yokuqinisekisa",
    verify: "Qinisekisa",
    verifying: "Kuyaqinisekiswa...",
    technicalDetails: "Imininingwane yezobuchwepheshe",
    genericErrorPrefix: "Iphutha",
    sendCodeTransportErrorMessage: "Asikwazanga ukuqinisekisa ukuthi isicelo sekhodi siqediwe yini. Bheka ikhodi ku-imeyili yakho, bese uzama futhi uma kudingeka.",
    verifyCodeTransportErrorMessage: "Asikwazanga ukuqinisekisa ukuthi ukungena ngemvume kuqediwe yini. Zama ikhodi futhi noma uvuselele ikhasi ukuze uhlole ukuthi usuvele ungenile yini.",
  },
  en: {
    pageTitle: "Sign in",
    backToWebsite: "Back to website",
    signInTitle: "Sign in",
    checkingSession: "Checking session...",
    emailLabel: "Email",
    sendCode: "Send code",
    sendingCode: "Sending...",
    checkEmailForCode: "Check your email for an 8-digit code. If you don't see it, check your spam folder.",
    verificationCodeLabel: "Verification code",
    verify: "Verify",
    verifying: "Verifying...",
    technicalDetails: "Technical details",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage:
      "We couldn't confirm whether the code request finished. Check your email for a code, then try again if needed.",
    verifyCodeTransportErrorMessage:
      "We couldn't confirm whether sign-in finished. Try the code again, or refresh the page to check whether you're already signed in.",
  },
  ar: {
    pageTitle: "تسجيل الدخول",
    backToWebsite: "العودة إلى الموقع",
    signInTitle: "تسجيل الدخول",
    checkingSession: "جارٍ التحقق من الجلسة...",
    emailLabel: "البريد الإلكتروني",
    sendCode: "إرسال الرمز",
    sendingCode: "جارٍ الإرسال...",
    checkEmailForCode: "تحقق من بريدك الإلكتروني للحصول على رمز مكوّن من 8 أرقام. إذا لم تجده، فتحقق من مجلد الرسائل غير المرغوب فيها.",
    verificationCodeLabel: "رمز التحقق",
    verify: "تحقق",
    verifying: "جارٍ التحقق...",
    technicalDetails: "التفاصيل التقنية",
    genericErrorPrefix: "خطأ",
    sendCodeTransportErrorMessage:
      "لم نتمكن من تأكيد اكتمال طلب الرمز. تحقق من بريدك الإلكتروني بحثًا عن الرمز، ثم حاول مرة أخرى إذا لزم الأمر.",
    verifyCodeTransportErrorMessage:
      "لم نتمكن من تأكيد اكتمال تسجيل الدخول. حاول إدخال الرمز مرة أخرى أو أعد تحميل الصفحة للتحقق مما إذا كنت قد سجلت الدخول بالفعل.",
  },
  "zh-Hans": {
    pageTitle: "登录",
    backToWebsite: "返回网站",
    signInTitle: "登录",
    checkingSession: "正在检查会话...",
    emailLabel: "电子邮件",
    sendCode: "发送验证码",
    sendingCode: "发送中...",
    checkEmailForCode: "请查看电子邮件中的 8 位验证码。如果没有看到，请检查垃圾邮件文件夹。",
    verificationCodeLabel: "验证码",
    verify: "验证",
    verifying: "验证中...",
    technicalDetails: "技术详情",
    genericErrorPrefix: "错误",
    sendCodeTransportErrorMessage:
      "我们无法确认验证码请求是否已完成。请检查电子邮件中的验证码，如有需要请重试。",
    verifyCodeTransportErrorMessage:
      "我们无法确认登录是否已完成。请再次输入验证码，或刷新页面检查你是否已经登录。",
  },
  fr: {
    pageTitle: "Connexion",
    backToWebsite: "Retour au site",
    signInTitle: "Connexion",
    checkingSession: "Vérification de la session...",
    emailLabel: "E-mail",
    sendCode: "Envoyer le code",
    sendingCode: "Envoi...",
    checkEmailForCode: "Consultez votre boîte mail : vous y trouverez un code à 8 chiffres. Si vous ne le voyez pas, vérifiez le dossier spam.",
    verificationCodeLabel: "Code de vérification",
    verify: "Vérifier",
    verifying: "Vérification...",
    technicalDetails: "Détails techniques",
    genericErrorPrefix: "Erreur",
    sendCodeTransportErrorMessage:
      "Nous n'avons pas pu confirmer si la demande de code a abouti. Cherchez le code dans votre boîte mail, puis réessayez si nécessaire.",
    verifyCodeTransportErrorMessage:
      "Nous n'avons pas pu confirmer si la connexion a abouti. Saisissez de nouveau le code ou actualisez la page pour voir si vous êtes déjà connecté.",
  },
  de: {
    pageTitle: "Anmelden",
    backToWebsite: "Zur Website zurück",
    signInTitle: "Anmelden",
    checkingSession: "Sitzung wird geprüft...",
    emailLabel: "E-Mail",
    sendCode: "Code senden",
    sendingCode: "Wird gesendet...",
    checkEmailForCode: "Prüfe deine E-Mail auf einen 8-stelligen Code. Wenn du ihn nicht siehst, prüfe den Spam-Ordner.",
    verificationCodeLabel: "Bestätigungscode",
    verify: "Bestätigen",
    verifying: "Wird bestätigt...",
    technicalDetails: "Technische Details",
    genericErrorPrefix: "Fehler",
    sendCodeTransportErrorMessage:
      "Wir konnten nicht bestätigen, ob die Code-Anfrage abgeschlossen wurde. Prüfe deine E-Mails auf einen Code und versuche es bei Bedarf erneut.",
    verifyCodeTransportErrorMessage:
      "Wir konnten nicht bestätigen, ob die Anmeldung abgeschlossen wurde. Versuche den Code erneut oder lade die Seite neu, um zu prüfen, ob du bereits angemeldet bist.",
  },
  hi: {
    pageTitle: "साइन इन",
    backToWebsite: "वेबसाइट पर वापस जाएं",
    signInTitle: "साइन इन",
    checkingSession: "सेशन जांचा जा रहा है...",
    emailLabel: "ईमेल",
    sendCode: "कोड भेजें",
    sendingCode: "भेजा जा रहा है...",
    checkEmailForCode: "8 अंकों का कोड पाने के लिए अपना ईमेल देखें। अगर यह न दिखे, तो स्पैम फ़ोल्डर देखें।",
    verificationCodeLabel: "सत्यापन कोड",
    verify: "सत्यापित करें",
    verifying: "सत्यापित किया जा रहा है...",
    technicalDetails: "तकनीकी विवरण",
    genericErrorPrefix: "त्रुटि",
    sendCodeTransportErrorMessage:
      "हम पुष्टि नहीं कर सके कि कोड अनुरोध पूरा हुआ या नहीं। कोड के लिए अपना ईमेल देखें, फिर जरूरत हो तो दोबारा कोशिश करें।",
    verifyCodeTransportErrorMessage:
      "हम पुष्टि नहीं कर सके कि साइन-इन पूरा हुआ या नहीं। कोड फिर से आजमाएं, या यह देखने के लिए पेज रीफ्रेश करें कि क्या आप पहले से साइन इन हैं।",
  },
  ja: {
    pageTitle: "サインイン",
    backToWebsite: "Webサイトに戻る",
    signInTitle: "サインイン",
    checkingSession: "セッションを確認しています...",
    emailLabel: "メールアドレス",
    sendCode: "コードを送信",
    sendingCode: "送信中...",
    checkEmailForCode: "メールで 8 桁のコードを確認してください。見つからない場合は、迷惑メールフォルダを確認してください。",
    verificationCodeLabel: "確認コード",
    verify: "確認",
    verifying: "確認中...",
    technicalDetails: "技術的な詳細",
    genericErrorPrefix: "エラー",
    sendCodeTransportErrorMessage:
      "コード送信リクエストが完了したか確認できませんでした。メールでコードを確認し、必要に応じてもう一度お試しください。",
    verifyCodeTransportErrorMessage:
      "サインインが完了したか確認できませんでした。コードをもう一度試すか、ページを再読み込みして、すでにサインイン済みか確認してください。",
  },
  "pt-BR": {
    pageTitle: "Entrar",
    backToWebsite: "Voltar ao site",
    signInTitle: "Entrar",
    checkingSession: "Verificando a sessão...",
    emailLabel: "E-mail",
    sendCode: "Enviar código",
    sendingCode: "Enviando...",
    checkEmailForCode: "Procure no seu e-mail um código de 8 dígitos. Se não encontrar, verifique a pasta de spam.",
    verificationCodeLabel: "Código de verificação",
    verify: "Verificar",
    verifying: "Verificando...",
    technicalDetails: "Detalhes técnicos",
    genericErrorPrefix: "Erro",
    sendCodeTransportErrorMessage:
      "Não conseguimos confirmar se o pedido do código foi concluído. Procure o código no seu e-mail e tente de novo se precisar.",
    verifyCodeTransportErrorMessage:
      "Não conseguimos confirmar se a entrada foi concluída. Digite o código de novo ou recarregue a página para ver se você já entrou.",
  },
  ru: {
    pageTitle: "Войти",
    backToWebsite: "Вернуться на сайт",
    signInTitle: "Войти",
    checkingSession: "Проверяем сеанс...",
    emailLabel: "Электронная почта",
    sendCode: "Отправить код",
    sendingCode: "Отправка...",
    checkEmailForCode: "Проверьте почту: там есть 8-значный код. Если его нет, проверьте папку «Спам».",
    verificationCodeLabel: "Код подтверждения",
    verify: "Подтвердить",
    verifying: "Проверка...",
    technicalDetails: "Технические детали",
    genericErrorPrefix: "Ошибка",
    sendCodeTransportErrorMessage:
      "Мы не смогли подтвердить, завершился ли запрос кода. Проверьте почту на наличие кода и при необходимости попробуйте еще раз.",
    verifyCodeTransportErrorMessage:
      "Мы не смогли подтвердить, завершился ли вход. Попробуйте ввести код еще раз или обновите страницу, чтобы проверить, вошли ли вы уже в систему.",
  },
  "es-MX": {
    pageTitle: "Iniciar sesión",
    backToWebsite: "Volver al sitio web",
    signInTitle: "Iniciar sesión",
    checkingSession: "Comprobando sesión...",
    emailLabel: "Correo electrónico",
    sendCode: "Enviar código",
    sendingCode: "Enviando...",
    checkEmailForCode: "Revisa tu correo para encontrar un código de 8 dígitos. Si no lo ves, revisa la carpeta de spam.",
    verificationCodeLabel: "Código de verificación",
    verify: "Verificar",
    verifying: "Verificando...",
    technicalDetails: "Detalles técnicos",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage:
      "No pudimos confirmar si la solicitud del código terminó. Revisa tu correo para encontrar un código y vuelve a intentarlo si hace falta.",
    verifyCodeTransportErrorMessage:
      "No pudimos confirmar si el inicio de sesión terminó. Intenta usar el código otra vez o recarga la página para comprobar si ya iniciaste sesión.",
  },
  "es-ES": {
    pageTitle: "Iniciar sesión",
    backToWebsite: "Volver al sitio web",
    signInTitle: "Iniciar sesión",
    checkingSession: "Comprobando la sesión...",
    emailLabel: "Correo electrónico",
    sendCode: "Enviar código",
    sendingCode: "Enviando...",
    checkEmailForCode: "Revisa tu correo para encontrar un código de 8 dígitos. Si no lo ves, revisa la carpeta de spam.",
    verificationCodeLabel: "Código de verificación",
    verify: "Verificar",
    verifying: "Verificando...",
    technicalDetails: "Detalles técnicos",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage:
      "No pudimos confirmar si la solicitud del código terminó. Revisa tu correo para encontrar un código y vuelve a intentarlo si hace falta.",
    verifyCodeTransportErrorMessage:
      "No pudimos confirmar si el inicio de sesión terminó. Intenta usar el código otra vez o recarga la página para comprobar si ya has iniciado sesión.",
  },
};

type CatalogInstallAnalyticsContext = Readonly<{
  collectorUrl: string;
  installJourneyId: string;
  packageVersionId: string;
}>;

export const renderLoginPage = (
  redirectUri: string,
  websiteHomeUrl: string,
  locale: LoginPageLocale,
  catalogInstallAnalyticsContext: CatalogInstallAnalyticsContext | null,
): string => {
  const copy = LOGIN_PAGE_COPY[locale];
  const direction = getLoginPageLocaleDirection(locale);

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="${AUTH_FAVICON_URL}">
  <title>${copy.pageTitle}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #000000;
      --surface: #1c1c1e;
      --surface-elevated: #1c1c1e;
      --surface-muted: #2c2c2e;
      --surface-muted-hover: #3a3a3c;
      --text: #f6f6f8;
      --text-secondary: rgba(235, 235, 245, 0.66);
      --accent: #c44b2d;
      --accent-strong: #d65a38;
      --border-strong: #8e8e93;
      --danger: #ff4d57;
      --radius-sm: 10px;
      --radius-md: 14px;
      --radius-xl: 24px;
      --radius-pill: 999px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100%;
    }

    html {
      background: var(--bg);
    }

    body {
      background: transparent;
      color: var(--text);
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "SF Pro Display",
        "SF Pro Text",
        system-ui,
        sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    ::selection {
      background: rgba(196, 75, 45, 0.34);
      color: var(--text);
    }

    .login-page {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 24px 16px;
      width: 100%;
    }

    .login-back-link {
      position: absolute;
      top: 18px;
      inset-inline-start: 18px;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding-inline: 14px;
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--surface-muted);
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 560;
      letter-spacing: 0;
      text-decoration: none;
      transition:
        background 140ms ease,
        color 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .login-back-link:hover {
        background: var(--surface-muted-hover);
        color: var(--text);
      }
    }

    .login-back-link:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 3px;
    }

    .login-card {
      width: 100%;
      max-width: 420px;
      border-radius: var(--radius-xl);
      padding: 30px;
      background: var(--surface);
    }

    .login-title {
      margin: 0 0 24px;
      font-size: clamp(2rem, 4vw, 2.4rem);
      font-weight: 760;
      line-height: 0.96;
      letter-spacing: 0;
    }

    .login-label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .login-input {
      display: block;
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      margin-bottom: 16px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: var(--surface-muted);
      color: var(--text);
      font-family: inherit;
      font-size: 16px;
      transition:
        background 140ms ease,
        outline-color 140ms ease;
    }

    .login-input::placeholder {
      color: rgba(235, 235, 245, 0.45);
    }

    .login-input:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 2px;
      background: var(--surface-muted-hover);
    }

    .login-btn {
      display: block;
      width: 100%;
      min-height: 44px;
      padding: 10px 14px;
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--accent);
      color: #fff5f2;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition:
        background 140ms ease,
        opacity 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .login-btn:hover {
        background: var(--accent-strong);
      }
    }

    .login-btn:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 3px;
    }

    .login-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .login-error {
      color: var(--danger);
      font-size: 13px;
      margin-bottom: 12px;
    }

    .login-error-message {
      margin: 0;
    }

    .login-error-details {
      margin-top: 8px;
    }

    .login-error-summary {
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      user-select: none;
    }

    .login-error-detail-text {
      margin: 8px 0 0;
      padding: 10px 12px;
      border: 0;
      border-radius: var(--radius-sm);
      background: var(--surface-muted);
      color: var(--text-secondary);
      font-family:
        ui-monospace,
        "SFMono-Regular",
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        "Liberation Mono",
        "Courier New",
        monospace;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .login-hint {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0 0 16px;
    }

    .login-status {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0;
    }

    .hidden { display: none; }

    @media (max-width: 768px) {
      .login-page {
        padding: 18px 14px;
      }

      .login-back-link {
        top: 14px;
        inset-inline-start: 14px;
      }

      .login-card {
        max-width: 100%;
        border-radius: var(--radius-md);
        padding: 24px 18px;
      }
    }
  </style>
</head>
<body>
  <div class="login-page">
    <a class="login-back-link" href="${websiteHomeUrl}">${copy.backToWebsite}</a>
    <div class="login-card">
      <h1 class="login-title">${copy.signInTitle}</h1>

      <div id="step-checking">
        <p class="login-status">${copy.checkingSession}</p>
      </div>

      <div id="step-email" class="hidden">
        <label class="login-label" for="login-email">${copy.emailLabel}</label>
        <input id="login-email" class="login-input" type="email" autocomplete="email" autofocus>
        <div id="email-error" class="login-error hidden"></div>
        <button id="send-btn" class="login-btn" type="button">${copy.sendCode}</button>
      </div>

      <div id="step-otp" class="hidden">
        <p class="login-hint">${copy.checkEmailForCode}</p>
        <label class="login-label" for="login-otp">${copy.verificationCodeLabel}</label>
        <input id="login-otp" class="login-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8">
        <div id="otp-error" class="login-error hidden"></div>
        <button id="verify-btn" class="login-btn" type="button">${copy.verify}</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      var redirectUri = ${JSON.stringify(redirectUri)};
      var copy = ${JSON.stringify(copy)};
      var uiLocale = ${JSON.stringify(locale)};
      var catalogInstallAnalyticsContext = ${JSON.stringify(catalogInstallAnalyticsContext)};

      var csrfToken = "";

      var emailInput = document.getElementById("login-email");
      var otpInput = document.getElementById("login-otp");
      var sendBtn = document.getElementById("send-btn");
      var verifyBtn = document.getElementById("verify-btn");
      var stepChecking = document.getElementById("step-checking");
      var stepEmail = document.getElementById("step-email");
      var stepOtp = document.getElementById("step-otp");
      var emailError = document.getElementById("email-error");
      var otpError = document.getElementById("otp-error");

      function showError(el, msg) {
        el.textContent = "";
        el.textContent = msg;
        el.classList.remove("hidden");
      }

      function showErrorWithDetails(el, msg, detailsText) {
        var message = document.createElement("p");
        message.className = "login-error-message";
        message.textContent = msg;

        var details = document.createElement("details");
        details.className = "login-error-details";

        var summary = document.createElement("summary");
        summary.className = "login-error-summary";
        summary.textContent = copy.technicalDetails;

        var technicalText = document.createElement("pre");
        technicalText.className = "login-error-detail-text";
        technicalText.textContent = detailsText;

        details.appendChild(summary);
        details.appendChild(technicalText);

        el.textContent = "";
        el.appendChild(message);
        el.appendChild(details);
        el.classList.remove("hidden");
      }

      function getTechnicalErrorDetails(err) {
        if (err && typeof err === "object") {
          var errorName = typeof err.name === "string" ? err.name : "";
          var errorMessage = typeof err.message === "string" ? err.message : "";

          if (errorName !== "" && errorMessage !== "") {
            return errorName + ": " + errorMessage;
          }

          if (errorMessage !== "") {
            return errorMessage;
          }
        }

        return String(err);
      }

      function hideError(el) {
        el.classList.add("hidden");
        el.textContent = "";
      }

      function showEmailStep() {
        stepChecking.classList.add("hidden");
        stepOtp.classList.add("hidden");
        stepEmail.classList.remove("hidden");
        emailInput.focus();
      }

      function createCatalogInstallEventId() {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        var timestampMs = Date.now();
        bytes[0] = Math.floor(timestampMs / Math.pow(2, 40)) & 255;
        bytes[1] = Math.floor(timestampMs / Math.pow(2, 32)) & 255;
        bytes[2] = Math.floor(timestampMs / Math.pow(2, 24)) & 255;
        bytes[3] = Math.floor(timestampMs / Math.pow(2, 16)) & 255;
        bytes[4] = Math.floor(timestampMs / Math.pow(2, 8)) & 255;
        bytes[5] = timestampMs & 255;
        bytes[6] = (bytes[6] & 15) | 112;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map.call(bytes, function(value) {
          return value.toString(16).padStart(2, "0");
        }).join("");
        return [
          hex.slice(0, 8),
          hex.slice(8, 12),
          hex.slice(12, 16),
          hex.slice(16, 20),
          hex.slice(20, 32),
        ].join("-");
      }

      function readCatalogInstallDeviceLocale() {
        var value = typeof navigator.language === "string" ? navigator.language.trim() : "";
        if (value === "" || value.length > 64 || typeof Intl.Locale !== "function") {
          return null;
        }
        try {
          var normalizedLocale = new Intl.Locale(value).toString();
          return normalizedLocale.length <= 64 ? normalizedLocale : null;
        } catch (_error) {
          return null;
        }
      }

      function warnCatalogInstallAnalytics(eventName, properties, statusCode, code, requestId) {
        console.warn("Catalog install analytics delivery failed", {
          eventName: eventName,
          stage: typeof properties.stage === "string" ? properties.stage : null,
          reason: typeof properties.reason === "string" ? properties.reason : null,
          statusCode: statusCode,
          code: code,
          requestId: requestId,
        });
      }

      function reportCatalogInstallEvent(eventName, extraProperties) {
        if (catalogInstallAnalyticsContext === null) {
          return;
        }

        var properties = {
          install_journey_id: catalogInstallAnalyticsContext.installJourneyId,
          package_version_id: catalogInstallAnalyticsContext.packageVersionId,
        };
        Object.keys(extraProperties).forEach(function(key) {
          properties[key] = extraProperties[key];
        });
        try {
          var clientOccurredAt = new Date().toISOString();
          fetch(catalogInstallAnalyticsContext.collectorUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            keepalive: true,
            body: JSON.stringify({
              eventId: createCatalogInstallEventId(),
              eventName: eventName,
              clientOccurredAt: clientOccurredAt,
              uiLocale: uiLocale,
              clientSentAt: new Date().toISOString(),
              deviceLocale: readCatalogInstallDeviceLocale(),
              properties: properties,
            }),
          }).then(function(response) {
            if (response.ok) {
              return;
            }
            return response.json().catch(function() {
              return null;
            }).then(function(data) {
              var code = data && typeof data.code === "string" ? data.code : null;
              var bodyRequestId = data && typeof data.requestId === "string" ? data.requestId : null;
              warnCatalogInstallAnalytics(
                eventName,
                properties,
                response.status,
                code,
                response.headers.get("X-Request-Id") || bodyRequestId,
              );
            });
          }).catch(function() {
            warnCatalogInstallAnalytics(eventName, properties, null, null, null);
          });
        } catch (_error) {
          warnCatalogInstallAnalytics(eventName, properties, null, null, null);
        }
      }

      function toCatalogInstallSignInFailureReason(statusCode, code) {
        if (navigator.onLine === false) {
          return "offline";
        }
        if (code === "OTP_SESSION_EXPIRED") {
          return "expired_code";
        }
        if (code === "OTP_CHALLENGE_CONSUMED") {
          return "code_already_used";
        }
        if (code === "OTP_CODE_INVALID" || code === "PASSWORD_SIGN_IN_FAILED") {
          return "invalid_code";
        }
        if (code === "RATE_LIMITED" || code === "OTP_TOO_MANY_ATTEMPTS" || statusCode === 429) {
          return "rate_limited";
        }
        if (statusCode === 401 || statusCode === 403) {
          return "unauthorized";
        }
        return "server_error";
      }

      function reportCatalogInstallSignInFailure(statusCode, code) {
        reportCatalogInstallEvent("catalog_install_failed", {
          stage: "signin",
          reason: toCatalogInstallSignInFailureReason(statusCode, code),
        });
      }

      function reportCatalogInstallSignInTransportFailure() {
        reportCatalogInstallEvent("catalog_install_failed", {
          stage: "signin",
          reason: navigator.onLine === false ? "offline" : "network_error",
        });
      }

      function tryRefreshSession() {
        // The screen marker tells the endpoint which of its callers this is; the audit of who may
        // send it is in server/analytics/signInFunnel.ts.
        return fetch("api/refresh-session?screen=signin&ui_locale=" + encodeURIComponent(uiLocale), {
          method: "POST",
          credentials: "same-origin",
        }).then(function(res) {
          if (res.ok) {
            reportCatalogInstallEvent("catalog_install_signin_succeeded", {});
            window.location.href = redirectUri;
            return;
          }

          showEmailStep();
        }).catch(function() {
          showEmailStep();
        });
      }

      otpInput.addEventListener("input", function() {
        otpInput.value = otpInput.value.replace(/\\D/g, "").slice(0, 8);
      });

      emailInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") sendBtn.click();
      });

      otpInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") verifyBtn.click();
      });

      sendBtn.addEventListener("click", function() {
        var email = emailInput.value.trim();
        if (!email) return;

        hideError(emailError);
        sendBtn.disabled = true;
        sendBtn.textContent = copy.sendingCode;

        fetch("api/send-code?screen=signin&ui_locale=" + encodeURIComponent(uiLocale), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ email: email }),
        })
          .then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok) {
                reportCatalogInstallSignInFailure(res.status, data.code);
                showError(emailError, data.error || copy.genericErrorPrefix + ": " + res.status);
                return;
              }
              if (
                typeof data.idToken === "string" && data.idToken !== ""
                && typeof data.refreshToken === "string" && data.refreshToken !== ""
              ) {
                // Configured review account emails can complete sign-in immediately.
                reportCatalogInstallEvent("catalog_install_signin_succeeded", {});
                window.location.href = redirectUri;
                return;
              }
              reportCatalogInstallEvent("catalog_install_signin_code_requested", {});
              csrfToken = data.csrfToken || "";
              stepEmail.classList.add("hidden");
              stepOtp.classList.remove("hidden");
              otpInput.focus();
            });
          })
          .catch(function(err) {
            reportCatalogInstallSignInTransportFailure();
            showErrorWithDetails(
              emailError,
              copy.sendCodeTransportErrorMessage,
              getTechnicalErrorDetails(err),
            );
          })
          .finally(function() {
            sendBtn.disabled = false;
            sendBtn.textContent = copy.sendCode;
          });
      });

      verifyBtn.addEventListener("click", function() {
        var code = otpInput.value.trim();
        if (code.length !== 8) return;

        hideError(otpError);
        verifyBtn.disabled = true;
        verifyBtn.textContent = copy.verifying;

        fetch("api/verify-code?screen=signin&ui_locale=" + encodeURIComponent(uiLocale), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            code: code,
            csrfToken: csrfToken,
          }),
        })
          .then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok) {
                reportCatalogInstallSignInFailure(res.status, data.code);
                showError(otpError, data.error || copy.genericErrorPrefix + ": " + res.status);
                return;
              }
              reportCatalogInstallEvent("catalog_install_signin_succeeded", {});
              window.location.href = redirectUri;
            });
          })
          .catch(function(err) {
            reportCatalogInstallSignInTransportFailure();
            showErrorWithDetails(
              otpError,
              copy.verifyCodeTransportErrorMessage,
              getTechnicalErrorDetails(err),
            );
          })
          .finally(function() {
            verifyBtn.disabled = false;
            verifyBtn.textContent = copy.verify;
          });
      });

      void tryRefreshSession();
    })();
  </script>
</body>
</html>`;
};
