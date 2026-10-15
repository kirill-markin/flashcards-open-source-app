import type { LoginPageLocale } from "../routes/browser/loginPageLocale.js";

type BrowserContinuationCopy = Readonly<{
  mailboxRequired: string;
  codeSent: string;
  restart: string;
  expired: string;
  requestNewCode: string;
  continue: string;
  completed: string;
}>;

export const BROWSER_CONTINUATION_COPY: Readonly<Record<LoginPageLocale, BrowserContinuationCopy>> = {
  en: {
    mailboxRequired: "Verify your email to finish this provider request.",
    codeSent: "Check your email for a 6–8 digit code, including your spam folder.",
    restart: "Start again", expired: "This request has expired. Start again.",
    requestNewCode: "Need another code? Start a new provider request.", continue: "Continue", completed: "Sign-in complete.",
  },
  ar: {
    mailboxRequired: "تحقق من بريدك الإلكتروني لإكمال طلب موفّر تسجيل الدخول.",
    codeSent: "ابحث في بريدك الإلكتروني، بما في ذلك مجلد الرسائل غير المرغوب فيها، عن رمز من 6 إلى 8 أرقام.",
    restart: "البدء من جديد", expired: "انتهت صلاحية هذا الطلب. ابدأ من جديد.",
    requestNewCode: "هل تحتاج إلى رمز آخر؟ ابدأ طلبًا جديدًا لدى موفّر تسجيل الدخول.", continue: "متابعة", completed: "اكتمل تسجيل الدخول.",
  },
  "zh-Hans": {
    mailboxRequired: "请验证你的电子邮箱以完成此次身份提供方请求。",
    codeSent: "请在邮箱中查找 6–8 位数字验证码，也请检查垃圾邮件文件夹。",
    restart: "重新开始", expired: "此请求已过期，请重新开始。",
    requestNewCode: "需要新验证码？请重新发起身份提供方请求。", continue: "继续", completed: "登录完成。",
  },
  fr: {
    mailboxRequired: "Vérifiez votre adresse e-mail pour terminer cette demande auprès du fournisseur.",
    codeSent: "Cherchez un code de 6 à 8 chiffres dans vos e-mails, y compris les indésirables.",
    restart: "Recommencer", expired: "Cette demande a expiré. Recommencez.",
    requestNewCode: "Besoin d’un autre code ? Lancez une nouvelle demande auprès du fournisseur.", continue: "Continuer", completed: "Connexion terminée.",
  },
  de: {
    mailboxRequired: "Bestätige deine E-Mail-Adresse, um diese Anbieteranfrage abzuschließen.",
    codeSent: "Suche in deinen E-Mails, auch im Spamordner, nach einem 6- bis 8-stelligen Code.",
    restart: "Neu beginnen", expired: "Diese Anfrage ist abgelaufen. Beginne neu.",
    requestNewCode: "Brauchst du einen neuen Code? Starte eine neue Anbieteranfrage.", continue: "Weiter", completed: "Anmeldung abgeschlossen.",
  },
  hi: {
    mailboxRequired: "इस प्रदाता अनुरोध को पूरा करने के लिए अपना ईमेल सत्यापित करें।",
    codeSent: "अपने ईमेल और स्पैम फ़ोल्डर में 6–8 अंकों का कोड देखें।",
    restart: "फिर से शुरू करें", expired: "इस अनुरोध की समय सीमा समाप्त हो गई है। फिर से शुरू करें।",
    requestNewCode: "दूसरा कोड चाहिए? प्रदाता के साथ नया अनुरोध शुरू करें।", continue: "जारी रखें", completed: "साइन इन पूरा हुआ।",
  },
  ja: {
    mailboxRequired: "このプロバイダへのリクエストを完了するには、メールアドレスを確認してください。",
    codeSent: "迷惑メールフォルダも含め、メールで6〜8桁のコードを確認してください。",
    restart: "やり直す", expired: "このリクエストは期限切れです。やり直してください。",
    requestNewCode: "別のコードが必要な場合は、プロバイダへのリクエストをやり直してください。", continue: "続ける", completed: "ログインが完了しました。",
  },
  "pt-BR": {
    mailboxRequired: "Verifique seu e-mail para concluir esta solicitação do provedor.",
    codeSent: "Procure um código de 6 a 8 dígitos no seu e-mail, incluindo a pasta de spam.",
    restart: "Recomeçar", expired: "Esta solicitação expirou. Recomece.",
    requestNewCode: "Precisa de outro código? Inicie uma nova solicitação com o provedor.", continue: "Continuar", completed: "Login concluído.",
  },
  ru: {
    mailboxRequired: "Подтвердите электронную почту, чтобы завершить этот запрос через провайдера.",
    codeSent: "Найдите в почте код из 6–8 цифр. Проверьте также папку «Спам».",
    restart: "Начать заново", expired: "Срок действия запроса истёк. Начните заново.",
    requestNewCode: "Нужен другой код? Начните новый запрос через провайдера.", continue: "Продолжить", completed: "Вход выполнен.",
  },
  "es-MX": {
    mailboxRequired: "Verifica tu correo electrónico para completar esta solicitud con el proveedor.",
    codeSent: "Busca un código de 6 a 8 dígitos en tu correo, incluida la carpeta de spam.",
    restart: "Empezar de nuevo", expired: "Esta solicitud venció. Empieza de nuevo.",
    requestNewCode: "¿Necesitas otro código? Inicia una nueva solicitud con el proveedor.", continue: "Continuar", completed: "Inicio de sesión completado.",
  },
  "es-ES": {
    mailboxRequired: "Verifica tu correo electrónico para completar esta solicitud con el proveedor.",
    codeSent: "Busca un código de 6 a 8 dígitos en tu correo, incluida la carpeta de spam.",
    restart: "Empezar de nuevo", expired: "Esta solicitud ha caducado. Empieza de nuevo.",
    requestNewCode: "¿Necesitas otro código? Inicia una nueva solicitud con el proveedor.", continue: "Continuar", completed: "Inicio de sesión completado.",
  },
  bg: {
    mailboxRequired: "Потвърдете имейла си, за да завършите тази заявка чрез доставчика.",
    codeSent: "Потърсете код от 6–8 цифри в имейла си, включително в папката за спам.",
    restart: "Започнете отново", expired: "Тази заявка е изтекла. Започнете отново.",
    requestNewCode: "Нужен ви е друг код? Започнете нова заявка чрез доставчика.", continue: "Продължаване", completed: "Входът е завършен.",
  },
  bn: {
    mailboxRequired: "এই প্রদানকারীর অনুরোধটি সম্পূর্ণ করতে আপনার ইমেইল যাচাই করুন।",
    codeSent: "আপনার ইমেইল ও স্প্যাম ফোল্ডারে 6–8 সংখ্যার কোডটি খুঁজুন।",
    restart: "আবার শুরু করুন", expired: "এই অনুরোধের মেয়াদ শেষ হয়েছে। আবার শুরু করুন।",
    requestNewCode: "আরেকটি কোড দরকার? প্রদানকারীর মাধ্যমে নতুন অনুরোধ শুরু করুন।", continue: "চালিয়ে যান", completed: "সাইন ইন সম্পূর্ণ হয়েছে।",
  },
  ca: {
    mailboxRequired: "Verifica el teu correu electrònic per completar aquesta sol·licitud amb el proveïdor.",
    codeSent: "Busca un codi de 6 a 8 dígits al correu, inclosa la carpeta de correu brossa.",
    restart: "Torna a començar", expired: "Aquesta sol·licitud ha caducat. Torna a començar.",
    requestNewCode: "Necessites un altre codi? Inicia una nova sol·licitud amb el proveïdor.", continue: "Continua", completed: "S’ha iniciat la sessió.",
  },
  cs: {
    mailboxRequired: "Ověřte svůj e-mail a dokončete tento požadavek u poskytovatele.",
    codeSent: "Vyhledejte v e-mailu 6–8místný kód, také ve složce se spamem.",
    restart: "Začít znovu", expired: "Platnost tohoto požadavku vypršela. Začněte znovu.",
    requestNewCode: "Potřebujete další kód? Zahajte nový požadavek u poskytovatele.", continue: "Pokračovat", completed: "Přihlášení dokončeno.",
  },
  da: {
    mailboxRequired: "Bekræft din e-mail for at fuldføre denne anmodning hos udbyderen.",
    codeSent: "Se efter en kode på 6–8 cifre i din e-mail, også i spammappen.",
    restart: "Start forfra", expired: "Denne anmodning er udløbet. Start forfra.",
    requestNewCode: "Brug for en ny kode? Start en ny anmodning hos udbyderen.", continue: "Fortsæt", completed: "Du er logget ind.",
  },
  el: {
    mailboxRequired: "Επαληθεύστε το email σας για να ολοκληρώσετε αυτό το αίτημα στον πάροχο.",
    codeSent: "Αναζητήστε κωδικό 6–8 ψηφίων στο email σας, μαζί με τον φάκελο ανεπιθύμητων.",
    restart: "Ξεκινήστε ξανά", expired: "Αυτό το αίτημα έληξε. Ξεκινήστε ξανά.",
    requestNewCode: "Χρειάζεστε άλλον κωδικό; Ξεκινήστε νέο αίτημα στον πάροχο.", continue: "Συνέχεια", completed: "Η σύνδεση ολοκληρώθηκε.",
  },
  et: {
    mailboxRequired: "Selle teenusepakkuja taotluse lõpetamiseks kinnita oma e-post.",
    codeSent: "Otsi e-postist 6–8-kohalist koodi, ka rämpspostikaustast.",
    restart: "Alusta uuesti", expired: "See taotlus on aegunud. Alusta uuesti.",
    requestNewCode: "Vajad uut koodi? Alusta teenusepakkujaga uut taotlust.", continue: "Jätka", completed: "Sisselogimine on lõpetatud.",
  },
  fa: {
    mailboxRequired: "برای تکمیل این درخواست ارائه‌دهنده، ایمیل خود را تأیید کنید.",
    codeSent: "در ایمیل خود، از جمله پوشهٔ هرزنامه، به دنبال کد ۶ تا ۸ رقمی بگردید.",
    restart: "شروع دوباره", expired: "این درخواست منقضی شده است. دوباره شروع کنید.",
    requestNewCode: "کد دیگری نیاز دارید؟ درخواست جدیدی با ارائه‌دهنده شروع کنید.", continue: "ادامه", completed: "ورود کامل شد.",
  },
  fi: {
    mailboxRequired: "Vahvista sähköpostisi viimeistelläksesi tämän palveluntarjoajan pyynnön.",
    codeSent: "Etsi sähköpostistasi 6–8-numeroinen koodi, myös roskapostikansiosta.",
    restart: "Aloita alusta", expired: "Tämä pyyntö on vanhentunut. Aloita alusta.",
    requestNewCode: "Tarvitsetko uuden koodin? Aloita uusi pyyntö palveluntarjoajan kautta.", continue: "Jatka", completed: "Kirjautuminen valmis.",
  },
  gu: {
    mailboxRequired: "પ્રદાતાની આ વિનંતી પૂર્ણ કરવા માટે તમારું ઇમેઇલ ચકાસો.",
    codeSent: "તમારા ઇમેઇલ અને સ્પામ ફોલ્ડરમાં 6–8 અંકનો કોડ શોધો.",
    restart: "ફરી શરૂ કરો", expired: "આ વિનંતીની સમયમર્યાદા પૂરી થઈ ગઈ છે. ફરી શરૂ કરો.",
    requestNewCode: "બીજો કોડ જોઈએ છે? પ્રદાતા સાથે નવી વિનંતી શરૂ કરો.", continue: "ચાલુ રાખો", completed: "સાઇન ઇન પૂર્ણ થયું.",
  },
  he: {
    mailboxRequired: "אמתו את כתובת הדוא״ל כדי להשלים בקשה זו אצל הספק.",
    codeSent: "חפשו בדוא״ל קוד בן 6–8 ספרות, כולל בתיקיית הספאם.",
    restart: "התחילו מחדש", expired: "תוקף הבקשה פג. התחילו מחדש.",
    requestNewCode: "צריכים קוד נוסף? התחילו בקשה חדשה אצל הספק.", continue: "המשך", completed: "הכניסה הושלמה.",
  },
  hr: {
    mailboxRequired: "Potvrdite svoju e-poštu da biste dovršili ovaj zahtjev putem pružatelja.",
    codeSent: "Potražite kod od 6 do 8 znamenki u e-pošti, uključujući neželjenu poštu.",
    restart: "Počnite ponovno", expired: "Ovaj je zahtjev istekao. Počnite ponovno.",
    requestNewCode: "Trebate drugi kod? Pokrenite novi zahtjev putem pružatelja.", continue: "Nastavi", completed: "Prijava je dovršena.",
  },
  hu: {
    mailboxRequired: "Ellenőrizd az e-mail-címed a szolgáltatói kérés befejezéséhez.",
    codeSent: "Keress egy 6–8 számjegyű kódot az e-mailjeid között, a levélszemét mappában is.",
    restart: "Újrakezdés", expired: "Ez a kérés lejárt. Kezdd újra.",
    requestNewCode: "Másik kódra van szükséged? Indíts új kérést a szolgáltatónál.", continue: "Folytatás", completed: "Sikeres bejelentkezés.",
  },
  id: {
    mailboxRequired: "Verifikasi email Anda untuk menyelesaikan permintaan penyedia ini.",
    codeSent: "Cari kode 6–8 digit di email Anda, termasuk folder spam.",
    restart: "Mulai lagi", expired: "Permintaan ini telah kedaluwarsa. Mulai lagi.",
    requestNewCode: "Perlu kode lain? Mulai permintaan baru dengan penyedia.", continue: "Lanjutkan", completed: "Berhasil masuk.",
  },
  is: {
    mailboxRequired: "Staðfestu netfangið þitt til að ljúka þessari beiðni hjá veitunni.",
    codeSent: "Leitaðu að 6–8 stafa tölukóða í tölvupóstinum þínum, líka í ruslpósti.",
    restart: "Byrja aftur", expired: "Þessi beiðni er útrunnin. Byrjaðu aftur.",
    requestNewCode: "Þarftu annan kóða? Byrjaðu nýja beiðni hjá veitunni.", continue: "Halda áfram", completed: "Innskráningu lokið.",
  },
  it: {
    mailboxRequired: "Verifica la tua email per completare questa richiesta con il provider.",
    codeSent: "Cerca un codice di 6–8 cifre nella tua email, anche nella cartella spam.",
    restart: "Ricomincia", expired: "Questa richiesta è scaduta. Ricomincia.",
    requestNewCode: "Ti serve un altro codice? Avvia una nuova richiesta con il provider.", continue: "Continua", completed: "Accesso completato.",
  },
  kn: {
    mailboxRequired: "ಈ ಪೂರೈಕೆದಾರರ ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ನಿಮ್ಮ ಇಮೇಲ್ ಪರಿಶೀಲಿಸಿ.",
    codeSent: "ನಿಮ್ಮ ಇಮೇಲ್ ಮತ್ತು ಸ್ಪ್ಯಾಮ್ ಫೋಲ್ಡರ್‌ನಲ್ಲಿ 6–8 ಅಂಕಿಗಳ ಕೋಡ್ ನೋಡಿ.",
    restart: "ಮತ್ತೆ ಪ್ರಾರಂಭಿಸಿ", expired: "ಈ ವಿನಂತಿಯ ಅವಧಿ ಮುಗಿದಿದೆ. ಮತ್ತೆ ಪ್ರಾರಂಭಿಸಿ.",
    requestNewCode: "ಮತ್ತೊಂದು ಕೋಡ್ ಬೇಕೇ? ಪೂರೈಕೆದಾರರೊಂದಿಗೆ ಹೊಸ ವಿನಂತಿ ಪ್ರಾರಂಭಿಸಿ.", continue: "ಮುಂದುವರಿಸಿ", completed: "ಸೈನ್ ಇನ್ ಪೂರ್ಣಗೊಂಡಿದೆ.",
  },
  ko: {
    mailboxRequired: "이 제공업체 요청을 완료하려면 이메일을 인증하세요.",
    codeSent: "스팸 폴더를 포함하여 이메일에서 6~8자리 코드를 확인하세요.",
    restart: "다시 시작", expired: "이 요청이 만료되었습니다. 다시 시작하세요.",
    requestNewCode: "다른 코드가 필요한가요? 제공업체에 새 요청을 시작하세요.", continue: "계속", completed: "로그인 완료.",
  },
  lt: {
    mailboxRequired: "Patvirtinkite el. paštą, kad užbaigtumėte šią teikėjo užklausą.",
    codeSent: "El. pašte ieškokite 6–8 skaitmenų kodo, taip pat ir šlamšto aplanke.",
    restart: "Pradėti iš naujo", expired: "Ši užklausa nebegalioja. Pradėkite iš naujo.",
    requestNewCode: "Reikia kito kodo? Pradėkite naują užklausą per teikėją.", continue: "Tęsti", completed: "Prisijungimas baigtas.",
  },
  lv: {
    mailboxRequired: "Apstipriniet e-pastu, lai pabeigtu šo pakalpojuma sniedzēja pieprasījumu.",
    codeSent: "E-pastā meklējiet 6–8 ciparu kodu, arī mēstuļu mapē.",
    restart: "Sākt no jauna", expired: "Šī pieprasījuma termiņš ir beidzies. Sāciet no jauna.",
    requestNewCode: "Vajadzīgs cits kods? Sāciet jaunu pieprasījumu pie pakalpojuma sniedzēja.", continue: "Turpināt", completed: "Pierakstīšanās pabeigta.",
  },
  ml: {
    mailboxRequired: "ഈ ദാതാവിന്റെ അഭ്യർത്ഥന പൂർത്തിയാക്കാൻ നിങ്ങളുടെ ഇമെയിൽ സ്ഥിരീകരിക്കുക.",
    codeSent: "നിങ്ങളുടെ ഇമെയിലിലും സ്പാം ഫോൾഡറിലും 6–8 അക്ക കോഡ് നോക്കുക.",
    restart: "വീണ്ടും തുടങ്ങുക", expired: "ഈ അഭ്യർത്ഥനയുടെ കാലാവധി കഴിഞ്ഞു. വീണ്ടും തുടങ്ങുക.",
    requestNewCode: "മറ്റൊരു കോഡ് വേണോ? ദാതാവിലൂടെ പുതിയ അഭ്യർത്ഥന തുടങ്ങുക.", continue: "തുടരുക", completed: "സൈൻ ഇൻ പൂർത്തിയായി.",
  },
  mr: {
    mailboxRequired: "या प्रदात्याची विनंती पूर्ण करण्यासाठी तुमचा ईमेल सत्यापित करा.",
    codeSent: "तुमच्या ईमेलमध्ये आणि स्पॅम फोल्डरमध्ये 6–8 अंकी कोड शोधा.",
    restart: "पुन्हा सुरू करा", expired: "या विनंतीची मुदत संपली आहे. पुन्हा सुरू करा.",
    requestNewCode: "दुसरा कोड हवा आहे? प्रदात्याद्वारे नवीन विनंती सुरू करा.", continue: "पुढे जा", completed: "साइन इन पूर्ण झाले.",
  },
  nb: {
    mailboxRequired: "Bekreft e-posten din for å fullføre denne forespørselen hos leverandøren.",
    codeSent: "Se etter en kode på 6–8 sifre i e-posten din, også i søppelpostmappen.",
    restart: "Start på nytt", expired: "Denne forespørselen har utløpt. Start på nytt.",
    requestNewCode: "Trenger du en ny kode? Start en ny forespørsel hos leverandøren.", continue: "Fortsett", completed: "Du er logget inn.",
  },
  nl: {
    mailboxRequired: "Verifieer je e-mailadres om dit verzoek bij de aanbieder te voltooien.",
    codeSent: "Zoek in je e-mail, ook in de spammap, naar een code van 6–8 cijfers.",
    restart: "Opnieuw beginnen", expired: "Dit verzoek is verlopen. Begin opnieuw.",
    requestNewCode: "Een andere code nodig? Start een nieuw verzoek bij de aanbieder.", continue: "Doorgaan", completed: "Inloggen voltooid.",
  },
  pa: {
    mailboxRequired: "ਇਸ ਪ੍ਰਦਾਤਾ ਦੀ ਬੇਨਤੀ ਪੂਰੀ ਕਰਨ ਲਈ ਆਪਣੀ ਈਮੇਲ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ।",
    codeSent: "ਆਪਣੀ ਈਮੇਲ ਅਤੇ ਸਪੈਮ ਫੋਲਡਰ ਵਿੱਚ 6–8 ਅੰਕਾਂ ਦਾ ਕੋਡ ਲੱਭੋ।",
    restart: "ਮੁੜ ਸ਼ੁਰੂ ਕਰੋ", expired: "ਇਸ ਬੇਨਤੀ ਦੀ ਮਿਆਦ ਪੁੱਗ ਗਈ ਹੈ। ਮੁੜ ਸ਼ੁਰੂ ਕਰੋ।",
    requestNewCode: "ਹੋਰ ਕੋਡ ਚਾਹੀਦਾ ਹੈ? ਪ੍ਰਦਾਤਾ ਨਾਲ ਨਵੀਂ ਬੇਨਤੀ ਸ਼ੁਰੂ ਕਰੋ।", continue: "ਜਾਰੀ ਰੱਖੋ", completed: "ਸਾਈਨ ਇਨ ਪੂਰਾ ਹੋਇਆ।",
  },
  pl: {
    mailboxRequired: "Zweryfikuj swój e-mail, aby dokończyć to żądanie u dostawcy.",
    codeSent: "Poszukaj kodu składającego się z 6–8 cyfr w poczcie, również w folderze spam.",
    restart: "Zacznij od nowa", expired: "To żądanie wygasło. Zacznij od nowa.",
    requestNewCode: "Potrzebujesz innego kodu? Rozpocznij nowe żądanie u dostawcy.", continue: "Kontynuuj", completed: "Logowanie zakończone.",
  },
  ro: {
    mailboxRequired: "Verifică adresa de e-mail pentru a finaliza această solicitare prin furnizor.",
    codeSent: "Caută un cod de 6–8 cifre în e-mail, inclusiv în folderul spam.",
    restart: "Începe din nou", expired: "Această solicitare a expirat. Începe din nou.",
    requestNewCode: "Ai nevoie de alt cod? Începe o solicitare nouă prin furnizor.", continue: "Continuă", completed: "Autentificare finalizată.",
  },
  sk: {
    mailboxRequired: "Overte svoj e-mail a dokončite túto požiadavku u poskytovateľa.",
    codeSent: "Vyhľadajte v e-maile 6–8-miestny kód, aj v priečinku so spamom.",
    restart: "Začať znova", expired: "Platnosť tejto požiadavky vypršala. Začnite znova.",
    requestNewCode: "Potrebujete iný kód? Začnite novú požiadavku u poskytovateľa.", continue: "Pokračovať", completed: "Prihlásenie dokončené.",
  },
  sl: {
    mailboxRequired: "Potrdite e-pošto, da dokončate to zahtevo pri ponudniku.",
    codeSent: "V e-pošti poiščite 6–8-mestno kodo, tudi v mapi z neželeno pošto.",
    restart: "Začni znova", expired: "Ta zahteva je potekla. Začnite znova.",
    requestNewCode: "Potrebujete drugo kodo? Začnite novo zahtevo pri ponudniku.", continue: "Nadaljuj", completed: "Prijava je končana.",
  },
  sv: {
    mailboxRequired: "Verifiera din e-post för att slutföra denna begäran hos leverantören.",
    codeSent: "Leta efter en kod med 6–8 siffror i din e-post, även i skräppostmappen.",
    restart: "Börja om", expired: "Den här begäran har gått ut. Börja om.",
    requestNewCode: "Behöver du en ny kod? Starta en ny begäran hos leverantören.", continue: "Fortsätt", completed: "Inloggningen är klar.",
  },
  sw: {
    mailboxRequired: "Thibitisha barua pepe yako ili kukamilisha ombi hili la mtoa huduma.",
    codeSent: "Tafuta msimbo wa tarakimu 6–8 kwenye barua pepe yako, pia kwenye folda ya taka.",
    restart: "Anza tena", expired: "Muda wa ombi hili umeisha. Anza tena.",
    requestNewCode: "Unahitaji msimbo mwingine? Anza ombi jipya kwa mtoa huduma.", continue: "Endelea", completed: "Umeingia.",
  },
  ta: {
    mailboxRequired: "இந்த வழங்குநர் கோரிக்கையை முடிக்க உங்கள் மின்னஞ்சலைச் சரிபார்க்கவும்.",
    codeSent: "தேவையற்ற அஞ்சல் கோப்புறை உட்பட உங்கள் மின்னஞ்சலில் 6–8 இலக்கக் குறியீட்டைத் தேடவும்.",
    restart: "மீண்டும் தொடங்கு", expired: "இந்தக் கோரிக்கை காலாவதியானது. மீண்டும் தொடங்கவும்.",
    requestNewCode: "வேறு குறியீடு வேண்டுமா? வழங்குநரிடம் புதிய கோரிக்கையைத் தொடங்கவும்.", continue: "தொடர்க", completed: "உள்நுழைவு முடிந்தது.",
  },
  te: {
    mailboxRequired: "ఈ ప్రొవైడర్ అభ్యర్థనను పూర్తి చేయడానికి మీ ఇమెయిల్‌ను ధృవీకరించండి.",
    codeSent: "మీ ఇమెయిల్‌లో మరియు స్పామ్ ఫోల్డర్‌లో 6–8 అంకెల కోడ్ కోసం చూడండి.",
    restart: "మళ్లీ ప్రారంభించండి", expired: "ఈ అభ్యర్థన గడువు ముగిసింది. మళ్లీ ప్రారంభించండి.",
    requestNewCode: "మరో కోడ్ కావాలా? ప్రొవైడర్‌తో కొత్త అభ్యర్థనను ప్రారంభించండి.", continue: "కొనసాగించండి", completed: "సైన్ ఇన్ పూర్తయింది.",
  },
  th: {
    mailboxRequired: "ยืนยันอีเมลของคุณเพื่อดำเนินคำขอผ่านผู้ให้บริการนี้ให้เสร็จสิ้น",
    codeSent: "ค้นหารหัส 6–8 หลักในอีเมลของคุณ รวมถึงโฟลเดอร์สแปม",
    restart: "เริ่มใหม่", expired: "คำขอนี้หมดอายุแล้ว โปรดเริ่มใหม่",
    requestNewCode: "ต้องการรหัสใหม่หรือไม่? เริ่มคำขอใหม่กับผู้ให้บริการ", continue: "ดำเนินการต่อ", completed: "เข้าสู่ระบบสำเร็จแล้ว",
  },
  tr: {
    mailboxRequired: "Bu sağlayıcı isteğini tamamlamak için e-postanızı doğrulayın.",
    codeSent: "Spam klasörü dahil e-postanızda 6–8 haneli bir kod arayın.",
    restart: "Yeniden başla", expired: "Bu isteğin süresi doldu. Yeniden başlayın.",
    requestNewCode: "Başka bir kod mu gerekiyor? Sağlayıcıyla yeni bir istek başlatın.", continue: "Devam et", completed: "Giriş tamamlandı.",
  },
  uk: {
    mailboxRequired: "Підтвердьте електронну пошту, щоб завершити цей запит через провайдера.",
    codeSent: "Знайдіть у пошті код із 6–8 цифр. Також перевірте папку «Спам».",
    restart: "Почати знову", expired: "Термін дії запиту минув. Почніть знову.",
    requestNewCode: "Потрібен інший код? Почніть новий запит через провайдера.", continue: "Продовжити", completed: "Вхід виконано.",
  },
  ur: {
    mailboxRequired: "اس فراہم کنندہ کی درخواست مکمل کرنے کے لیے اپنے ای میل کی تصدیق کریں۔",
    codeSent: "اپنے ای میل اور اسپیم فولڈر میں 6–8 ہندسوں کا کوڈ تلاش کریں۔",
    restart: "دوبارہ شروع کریں", expired: "اس درخواست کی میعاد ختم ہو گئی ہے۔ دوبارہ شروع کریں۔",
    requestNewCode: "دوسرا کوڈ چاہیے؟ فراہم کنندہ کے ساتھ نئی درخواست شروع کریں۔", continue: "جاری رکھیں", completed: "سائن ان مکمل ہو گیا۔",
  },
  vi: {
    mailboxRequired: "Xác minh email để hoàn tất yêu cầu này với nhà cung cấp.",
    codeSent: "Tìm mã gồm 6–8 chữ số trong email, bao gồm cả thư mục thư rác.",
    restart: "Bắt đầu lại", expired: "Yêu cầu này đã hết hạn. Hãy bắt đầu lại.",
    requestNewCode: "Cần mã khác? Hãy bắt đầu yêu cầu mới với nhà cung cấp.", continue: "Tiếp tục", completed: "Đăng nhập hoàn tất.",
  },
  zu: {
    mailboxRequired: "Qinisekisa i-imeyili yakho ukuze uqedele lesi sicelo somhlinzeki.",
    codeSent: "Bheka ikhodi enezinombolo ezingu-6–8 ku-imeyili yakho, nasefoldeni yogaxekile.",
    restart: "Qala kabusha", expired: "Lesi sicelo siphelelwe isikhathi. Qala kabusha.",
    requestNewCode: "Udinga enye ikhodi? Qala isicelo esisha ngomhlinzeki.", continue: "Qhubeka", completed: "Ukungena ngemvume kuqediwe.",
  },
};
