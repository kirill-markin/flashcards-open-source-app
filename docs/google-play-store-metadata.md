# Google Play Store Metadata

Related competitor references: [Android competitors](competitor-store-metadata.md#android)

Premium subscription configuration and texts: [subscription store metadata](subscription-store-metadata.md)

For locale mapping, assets, repository delivery, and Play publication, use the
[listing localization runbook](../apps/android/docs/play-store-localization-runbook.md).

## Which languages live in this file

This file holds authored Play listing copy for 87 locales, including regional listings. Each section owns its app name, short description, and full description. Play locale codes can differ from app locale codes: for example, `es-419` maps to `es-MX`, and `iw-IL` maps to `he`. The `es-US` listing has no matching product locale.

So a section here is not evidence that a shipped build carries that language. Before publishing a listing, check the client locale lists in `apps/web/src/i18n/types.ts`, `apps/android/app/src/main/res/xml/locales_config.xml`, and the iOS `knownRegions` in `apps/ios/Flashcards/Flashcards Open Source App.xcodeproj/project.pbxproj`.

Google Play may auto-translate listings for other languages. That generated copy is absent here because it has no repository source of truth. Publishing authored copy replaces auto-translated text for that locale.

### App and listing locale mappings

| App locale | Google Play listing and release-note codes |
| --- | --- |
| `zh-Hant` | `zh-TW`, `zh-HK` |
| `en-AU` | `en-AU` |
| `en-CA` | `en-CA` |
| `en-GB` | `en-GB` |
| `fr-CA` | `fr-CA` |
| `pt-PT` | `pt-PT` |
| `ms` | `ms`, `ms-MY` |
| `or` | Unavailable |

Google Play's [published listing language list](https://support.google.com/googleplay/android-developer/answer/9844778?hl=en#zippy=%2Cview-list-of-available-languages) omits Odia.

## Default - English (United States) - en-US

### App Name

Nibomo: AI Flashcard Maker

### Short Description

Turn notes and photos into flashcards. Review offline with spaced repetition.

### Full Description

Turn class notes, photos, and topics into flashcards with Nibomo's AI flashcard maker. Build your own decks, review with spaced repetition, and keep studying offline once your cards are saved.

Make flashcards from your study material
Paste lecture notes, attach a photo of a notebook page, or describe a topic you want to learn. Ask AI to focus on the definitions, examples, or key facts you need to remember. Edit the questions and answers so they make sense to you. You can also make your own flashcards one card at a time.

Remember more with spaced repetition
Read the question and try to answer it from memory. Flip the card and rate how well you recalled it. Nibomo schedules the next review based on your rating, so difficult cards return sooner and familiar cards wait longer. Use this routine to review course material before an exam or keep important concepts fresh after it.

Practice English and Spanish vocabulary
Make vocabulary flashcards from the words you encounter in class, in a book, or in conversation. Add your own example sentences so you remember how a word is used. You can also start with a ready-made deck from the Nibomo catalog, such as English phrasal verbs or beginner Spanish vocabulary.

Review your flashcards offline
Open your saved cards on the train, between classes, or anywhere you have a few minutes. Your reviews sync when you reconnect, so you can pick up where you left off on another device.

AI features require an internet connection.

### Release notes

- Subscribe to Premium and customize accent colors.
- Use your own OpenAI API key and view AI usage.
- Confirm deck deletion and navigate improved settings.

## Arabic - ar

### App Name

Nibomo: صانع فلاش كارد

### Short Description

حوّل الملاحظات والصور إلى بطاقات وراجعها بالتكرار المتباعد، حتى دون إنترنت.

### Full Description

أنشئ بطاقات للمذاكرة من ملاحظاتك وصورك مع Nibomo. استخدم الذكاء الاصطناعي لصياغة الأسئلة، ونظّم البطاقات في مجموعات، وراجعها بالتكرار المتباعد.

بطاقات من ملاحظاتك وصورك
الصق ملاحظات المحاضرة أو أرفق صورة من دفترك أو اكتب الموضوع الذي تريد مذاكرته. اطلب من الذكاء الاصطناعي التركيز على التعريفات أو الأمثلة أو الأفكار الرئيسية. عدّل الأسئلة والأجوبة قبل المراجعة، أو أنشئ البطاقات بنفسك واحدة تلو الأخرى.

التكرار المتباعد للمذاكرة
اقرأ السؤال وحاول استرجاع الإجابة قبل قلب البطاقة. بعد أن تقيّم تذكّرك، يحدّد Nibomo موعد المراجعة التالية. تظهر البطاقات الصعبة مجددًا في وقت أقرب، ويطول الفاصل بين مراجعات البطاقات التي تتذكّرها بسهولة.

بطاقات المفردات
حوّل الكلمات التي تصادفها في القراءة أو المحادثة إلى بطاقات. أضف مثالًا يوضّح استخدام الكلمة. ويمكنك البدء من مكتبة Nibomo بمجموعة للأفعال المركّبة بالإنجليزية أو للمفردات الإسبانية للمبتدئين.

مراجعة البطاقات دون إنترنت
راجع بطاقاتك المحفوظة في طريقك أو بين المحاضرات. عند عودة الاتصال، سجّل الدخول بالحساب نفسه لمزامنة مراجعاتك ومتابعة الدراسة على أجهزتك الأخرى.

تتطلّب ميزات الذكاء الاصطناعي اتصالًا بالإنترنت.

### Release notes

- اشترك في Premium وخصّص ألوان التمييز.
- استخدم مفتاح OpenAI API الخاص بك واطّلع على استخدام الذكاء الاصطناعي.
- أكّد حذف مجموعات البطاقات وتصفّح الإعدادات المحسّنة.

## Chinese (Simplified) - zh-CN

### App Name

Nibomo：AI 抽认卡生成器

### Short Description

把笔记和照片变成闪卡，用间隔重复复习，离线也能背单词。

### Full Description

用 Nibomo 把课堂笔记、照片和想学的主题做成抽认卡。创建自己的卡组，按间隔重复法安排复习，没网时也能打开已保存的卡片。

从笔记或照片制作闪卡
贴上课堂笔记、附上一张照片，或描述想学的主题。让 AI 围绕定义、例子或关键知识点生成问答，检查和修改后再开始复习。也可以自己一张张写卡，把需要记住的内容整理到同一个卡组。

用间隔重复巩固记忆
看着问题先在心里作答，再翻卡并评价记得怎么样。Nibomo 根据你的评价安排下次复习，难记的卡片早点出现，熟悉的卡片隔得久一点。既可以考前复习，也可以在学完后定期回顾。

用单词卡练习英语和西班牙语
把上课、阅读或聊天时遇到的生词做成卡片。给单词加上自己的例句，记住它在句子里怎么用。想直接开始，也可以从 Nibomo 的卡组目录选一套英语短语动词或西班牙语入门词汇卡。

离线复习已保存的卡片
在地铁上或课间，用几分钟过一遍卡片。重新联网后可同步复习进度，在另一台设备上接着学。

AI 功能需要联网。

### Release notes

- 订阅 Premium，自定义界面强调色。
- 使用自己的 OpenAI API 密钥，查看 AI 用量。
- 删除牌组前进行确认，轻松浏览改进后的设置。

## French - fr-FR

### App Name

Nibomo : Cartes flash IA

### Short Description

Créez des cartes à partir de notes ou de photos. Révisez hors ligne.

### Full Description

Créez des cartes flash à partir de notes de cours, de photos ou d’un sujet à réviser. Le générateur de flashcards de Nibomo prépare des questions et des réponses que vous pouvez modifier avant de les étudier.

Transformez vos supports de cours en cartes
Collez vos notes ou joignez la photo d’une page de cahier. Demandez à l’IA de cibler les définitions, les exemples ou les notions que vous voulez retenir. Reformulez une question ou complétez une réponse à votre convenance. Vous pouvez aussi créer vos propres cartes une par une.

Mémorisez avec la répétition espacée
Essayez de répondre avant de retourner la carte. Indiquez ensuite à quel point vous vous souveniez de la réponse. Nibomo planifie la prochaine révision et vous présente plus tôt les cartes difficiles.

Enrichissez votre vocabulaire
Faites des cartes de vocabulaire à partir des mots rencontrés en cours, dans un livre ou au fil d’une conversation. Ajoutez une phrase d’exemple ou choisissez un paquet du catalogue, comme les verbes à particule en anglais ou le vocabulaire espagnol de base.

Révisez vos cartes hors ligne
Ouvrez les cartes déjà enregistrées entre deux cours ou dans les transports. Vos révisions se synchronisent lorsque vous retrouvez une connexion.

Les fonctions d’IA nécessitent une connexion Internet.

### Release notes

- Abonnez-vous à Premium et personnalisez les couleurs d’accentuation.
- Utilisez votre propre clé API OpenAI et consultez votre utilisation de l’IA.
- Confirmez la suppression des paquets et profitez de réglages plus faciles à parcourir.

## German - de-DE

### App Name

Nibomo: KI-Karteikarten

### Short Description

Erstelle Karteikarten aus Notizen und Fotos. Wiederhole sie auch offline.

### Full Description

Erstelle Karteikarten mit KI aus Notizen, Fotos oder einem Thema. Nutze Nibomo als Vokabeltrainer und wiederhole deine Lernkarten in passenden Abständen, auch unterwegs ohne Netz.

Karteikarten aus deinen Notizen
Füge eine Mitschrift oder ein Foto von einer Heftseite hinzu und lass dir von der KI Fragen und Antworten vorschlagen. Du kannst die Vorschläge überarbeiten oder deine Lernkarten selbst erstellen.

In passenden Abständen wiederholen
Versuche, dich an die Antwort zu erinnern, bevor du die Karte umdrehst. Bewerte anschließend, wie gut du sie wusstest. Beim verteilten Wiederholen (Spaced Repetition) kommen schwierige Karten früher wieder und vertraute später.

Englische und spanische Vokabeln üben
Erstelle einen Stapel mit Wörtern aus deinem Unterricht oder ergänze eigene Beispielsätze. Im Nibomo-Katalog findest du fertige Stapel, etwa zu englischen Phrasal Verbs oder Spanisch für den Einstieg.

Gespeicherte Karten kannst du offline wiederholen. Dein Fortschritt wird synchronisiert, sobald du wieder online bist. Für KI-Funktionen brauchst du Internet.

### Release notes

- Abonniere Premium und passe die Akzentfarben an.
- Nutze deinen eigenen OpenAI-API-Schlüssel und sieh dir deine KI-Nutzung an.
- Bestätige das Löschen von Stapeln und finde dich leichter in den Einstellungen zurecht.

## Hindi - hi-IN

### App Name

Nibomo: AI फ्लैश कार्ड

### Short Description

नोट्स और फ़ोटो से फ्लैश कार्ड बनाएँ। सहेजे हुए कार्ड ऑफलाइन दोहराएँ।

### Full Description

क्लास के नोट्स, कॉपी के पन्ने की फ़ोटो या किसी विषय से Nibomo में फ्लैश कार्ड बनाएँ। अपने डेक तैयार करें और कार्ड सहेजने के बाद इंटरनेट के बिना भी पढ़ें।

नोट्स से फ्लैश कार्ड बनाएँ
अपने नोट्स पेस्ट करें या फ़ोटो जोड़ें। AI को बताएँ कि किन परिभाषाओं, उदाहरणों या तथ्यों के सवाल बनाने हैं। पढ़ने से पहले सवाल और जवाब अपनी ज़रूरत के मुताबिक बदलें। चाहें तो हर कार्ड खुद लिखें।

अंतराल पर दोहराएँ
सवाल पढ़कर जवाब याद करने की कोशिश करें। कार्ड पलटें और बताएँ कि जवाब कितनी अच्छी तरह याद था। स्पेस्ड रिपीटिशन में इसी आधार पर अगली बार कार्ड दिखाने का समय तय होता है। मुश्किल कार्ड जल्दी लौटते हैं और आसान कार्ड थोड़े लंबे अंतराल के बाद आते हैं।

अंग्रेज़ी शब्द सीखें और उनका अभ्यास करें
किसी किताब में या बातचीत में मिले नए शब्दों से शब्दावली के फ्लैश कार्ड बनाएँ। हर शब्द के साथ अपना उदाहरण वाक्य लिखें। आप Nibomo के कैटलॉग से अंग्रेज़ी के फ़्रेज़ल वर्ब या शुरुआती स्पैनिश शब्दावली का डेक भी चुन सकते हैं।

सहेजे हुए फ्लैश कार्ड ऑफलाइन दोहराएँ
सफ़र के दौरान या क्लास के बीच कुछ मिनट मिलें तो सहेजे हुए कार्ड खोलें। इंटरनेट से फिर जुड़ने पर प्रगति सिंक होती है। उसी खाते से दूसरे डिवाइस पर पढ़ाई जारी रख सकते हैं।

AI सुविधाओं के लिए इंटरनेट ज़रूरी है।

### Release notes

- Premium की सदस्यता लें और अपनी पसंद के एक्सेंट रंग चुनें।
- अपनी OpenAI API कुंजी इस्तेमाल करें और AI का उपयोग देखें।
- डेक हटाने से पहले पुष्टि करें और बेहतर सेटिंग्स में आसानी से नेविगेट करें।

## Japanese - ja-JP

### App Name

Nibomo: AIで作る暗記カード

### Short Description

ノートや写真から暗記カードを作成。間隔反復で覚え、保存したカードはオフラインでも復習。

### Full Description

授業のノートや写真から暗記カードを作りましょう。Nibomoなら、自分の学習資料を問題と答えにまとめ、間隔反復で復習できます。

ノートや写真から暗記カードを作成
ノートを貼り付ける、ノートのページを撮った写真を添付する、学びたいテーマを伝える。覚えたい定義や例を指定すると、AIが問題と答えの下書きを作ります。下書きは編集でき、カードを一枚ずつ手作りすることもできます。

間隔反復で、覚えにくい内容を早めに復習
質問を読んだら、まず答えを思い出してからカードをめくります。どのくらい覚えていたかを評価すると、次の復習までの間隔が調整されます。苦手なカードは早めに、覚えたカードは少し間を空けて出てきます。

英単語やスペイン語の単語帳を作る
授業や読書、会話で出会った単語をカードに。自分で例文を書き加えると、意味だけでなく使い方も確認できます。Nibomoのカタログにある英語の句動詞や初級スペイン語のカードセットから始めることもできます。

保存したカードをオフラインで復習
通学中や授業の合間に、保存済みのカードを開いて復習できます。ネットにつなぎ直すと進捗を同期でき、別の端末でも続きから学べます。

AI機能にはインターネット接続が必要です。

### Release notes

- Premiumに登録して、アクセントカラーをカスタマイズできます。
- 自分のOpenAI APIキーを使い、AIの利用状況を確認できます。
- デッキ削除前の確認に対応し、設定も使いやすくなりました。

## Portuguese (Brazil) - pt-BR

### App Name

Nibomo: Flashcards com IA

### Short Description

Crie flashcards de anotações e fotos. Revise offline com repetição espaçada.

### Full Description

Crie flashcards a partir de anotações de aula, fotos ou temas que você quer estudar. Use o gerador de flashcards com IA do Nibomo para montar seus baralhos e revisar com repetição espaçada.

Passe das anotações aos cartões
Cole as anotações ou anexe uma foto de uma página do caderno. Peça à IA para elaborar perguntas sobre definições, exemplos ou conceitos importantes. Ajuste as perguntas e respostas antes de começar. Você também pode escrever seus cartões do zero.

Lembre-se do que estudou
Tente responder antes de virar o cartão. Depois, indique como foi lembrar da resposta. O Nibomo programa a próxima revisão de acordo com sua avaliação, trazendo de volta primeiro os cartões mais difíceis.

Aprenda vocabulário em inglês e espanhol
Crie flashcards de vocabulário com palavras que encontrou numa leitura ou conversa. Acrescente uma frase de exemplo para lembrar do uso. Se quiser começar com um baralho pronto, no catálogo há verbos frasais em inglês e vocabulário de espanhol para iniciantes.

Revise seus flashcards offline
Abra os cartões salvos no ônibus ou no intervalo da aula. Seus registros de revisão são sincronizados quando você se conecta novamente.

Os recursos de IA precisam de conexão com a internet.

### Release notes

- Assine o Premium e personalize as cores de destaque.
- Use sua própria chave de API da OpenAI e confira o uso de IA.
- Confirme a exclusão de baralhos e navegue com mais facilidade pelas configurações.

## Russian - ru-RU

### App Name

Nibomo: Флешкарты с ИИ

### Short Description

Карточки для запоминания из конспектов и фото. Повторяйте офлайн.

### Full Description

Создавайте карточки для запоминания из заметок, конспектов и фотографий. Используйте ИИ, чтобы составить вопросы и ответы, собирайте свои колоды и закрепляйте материал с помощью интервального повторения.

Создавайте флешкарты из своих материалов
Вставьте конспект лекции, добавьте фото страницы тетради или укажите тему. Попросите ИИ выделить нужные определения, примеры или ключевые факты. Проверьте и отредактируйте вопросы и ответы перед учёбой. Можно также создать карточки вручную и собрать их в колоды по темам.

Закрепляйте знания с интервальным повторением
Прочитайте вопрос и попробуйте ответить по памяти. Затем переверните карточку и оцените, насколько хорошо вы вспомнили ответ. По этой оценке Nibomo запланирует следующее повторение. Сложные карточки появятся раньше, а знакомые — позже.

Учите английские и испанские слова
Соберите карточки для изучения слов, которые встречаются на занятиях, в книгах или разговорах. Добавьте свои примеры, чтобы помнить, как употребляются слова. В каталоге Nibomo есть и готовые колоды, например с английскими фразовыми глаголами и базовой испанской лексикой.

Повторяйте флешкарты офлайн
Открывайте сохранённые карточки в дороге и между занятиями. Чтобы синхронизировать прогресс между устройствами, подключитесь к интернету и войдите в один и тот же аккаунт.

Для функций ИИ нужно подключение к интернету.

### Release notes

- Оформляйте подписку Premium и настраивайте акцентные цвета.
- Используйте свой API-ключ OpenAI и просматривайте статистику использования ИИ.
- Подтверждайте удаление колод и пользуйтесь более удобными настройками.

## Spanish (Latin America) - es-419

### App Name

Nibomo: Flashcards con IA

### Short Description

Convierte apuntes y fotos en tarjetas. Repasa sin internet.

### Full Description

Crea tarjetas de estudio con tus apuntes, fotos o temas de clase. Con Nibomo puedes hacer flashcards con IA, organizar tus propios mazos y estudiar con repetición espaciada.

Convierte tus apuntes en tarjetas
Pega el texto o adjunta una foto de una página del cuaderno. Pídele a la IA preguntas y respuestas sobre lo que necesitas recordar, desde definiciones hasta ejemplos. Edita el contenido antes de estudiar o escribe tus tarjetas desde cero.

Recuerda lo que estudias
Intenta responder sin mirar el reverso. Luego voltea la tarjeta e indica qué tan bien la recordaste. Nibomo programa el próximo repaso según tu respuesta, para que vuelvas a ver primero lo que más se te dificulta.

Practica vocabulario en inglés
Crea tarjetas de vocabulario con palabras nuevas y agrega oraciones de ejemplo. Si quieres empezar con un mazo listo, en el catálogo encontrarás verbos frasales en inglés y vocabulario básico en español.

Repasa tus flashcards sin internet
Una vez guardadas, puedes abrir tus tarjetas en el camino o entre clases. Los repasos se sincronizan cuando recuperas la conexión, para que puedas continuar en otro dispositivo.

Las funciones de IA necesitan conexión a internet.

### Release notes

- Suscríbete a Premium y personaliza los colores de acento.
- Usa tu propia clave de API de OpenAI y consulta tu uso de IA.
- Confirma la eliminación de mazos y navega más fácilmente por los ajustes.

## Spanish (Spain) - es-ES

### App Name

Nibomo: Fichas de estudio

### Short Description

Crea fichas con IA a partir de apuntes o fotos. Repasa sin conexión.

### Full Description

Crea fichas de estudio a partir de apuntes, fotos o un tema. Con el generador de flashcards de Nibomo puedes convertir el material de clase en preguntas y preparar repasos a tu ritmo.

De los apuntes a las flashcards
Pega unos apuntes o adjunta una foto de tu cuaderno. Pide a la IA que se centre en los conceptos, las definiciones o los ejemplos que necesitas. Edita las preguntas y las respuestas antes de ponerte a estudiar. También puedes crear tus fichas una a una.

Repasa con repetición espaciada
Intenta contestar antes de girar la ficha. Después indica cuánto te ha costado recordar la respuesta. Así, Nibomo te vuelve a mostrar antes las fichas difíciles y deja más tiempo entre los repasos de las que ya dominas.

Crea tarjetas de vocabulario
Prepara fichas con las palabras en inglés que encuentres en clase o al leer. Añade ejemplos de uso o empieza con un mazo del catálogo, como el de verbos con partícula en inglés o el de vocabulario básico en español.

Llévate tus fichas
Repasa sin conexión las fichas guardadas, en el transporte o entre clases. Tus repasos se sincronizan al volver a conectarte.

Las funciones de IA necesitan conexión a internet.

### Release notes

- Suscríbete a Premium y personaliza los colores de acento.
- Usa tu propia clave de API de OpenAI y consulta tu uso de IA.
- Confirma la eliminación de mazos y navega más fácilmente por los ajustes.

## Spanish (United States) - es-US

### App Name

Nibomo: Tarjetas de estudio

### Short Description

Convierte notas y fotos en tarjetas con IA. Repasa sin internet.

### Full Description

Convierte tus notas de clase y fotos en tarjetas de estudio con Nibomo. Crea flashcards con IA para repasar conceptos, practicar vocabulario en inglés y recordar lo que estudias.

Crea tarjetas con tus notas
Pega tus notas, toma una foto de la página o describe el tema. Pídele a la IA que redacte preguntas y respuestas sobre las ideas que quieras retener. Revisa el resultado y ajústalo. También puedes escribir tus propias tarjetas una por una.

Estudia con repetición espaciada
Lee la pregunta y trata de responder antes de voltear la tarjeta. Luego indica si te resultó fácil o difícil recordar la respuesta. Nibomo programa el próximo repaso y vuelve a mostrarte antes las tarjetas más difíciles.

Practica palabras en inglés y español
Haz tarjetas de vocabulario con palabras que encuentres en clase, en el trabajo o en una conversación. Agrega tus propios ejemplos, o elige un mazo del catálogo de Nibomo, como el de verbos frasales en inglés o el de vocabulario básico en español.

Repasa sin internet
Abre las tarjetas que ya guardaste cuando estés en el transporte o tengas unos minutos libres. Los repasos se sincronizan al volver a conectarte.

Las funciones de IA necesitan conexión a internet.

### Release notes

- Suscríbete a Premium y personaliza los colores de acento.
- Usa tu propia clave de API de OpenAI y consulta tu uso de IA.
- Confirma la eliminación de mazos y navega más fácilmente por los ajustes.

## Bulgarian - bg

### App Name

Nibomo: Флаш карти с ИИ

### Short Description

Флаш карти от бележки и снимки. Интервално повторение и преговор офлайн.

### Full Description

Създавайте флаш карти от учебните си материали с Nibomo. Превърнете бележки от лекция, снимка на страница от тетрадка или тема в карти с въпроси и отговори. После ги преговаряйте с интервално повторение.

Създавайте свои карти
Поставете откъс от записките си или добавете снимка. ИИ ще предложи въпроси и отговори, които можете да редактирате. Можете също сами да напишете всяка карта и да подредите материала в отделни тестета.

Запомняйте с интервално повторение
Прочетете въпроса и се опитайте да отговорите, преди да обърнете картата. После отбележете доколко сте запомнили отговора. Nibomo планира следващия преговор според оценката ви, като показва по-трудните карти по-скоро.

Упражнявайте нови думи
Създавайте флашкарти за английски или испански думи и добавяйте собствени примери. Можете и да започнете с готово тесте от каталога Nibomo, например с английски фразови глаголи или испански думи и изрази за начинаещи.

Преговаряйте офлайн
Отворете запазените си карти и без интернет. Когато се свържете отново, напредъкът ви се синхронизира между устройствата.

Функциите с ИИ изискват интернет връзка.

### Release notes

- Абонирайте се за Premium и персонализирайте акцентните цветове.
- Използвайте собствен API ключ за OpenAI и следете използването на ИИ.
- Потвърждавайте изтриването на тестета и се ориентирайте по-лесно в настройките.

## Bengali (Bangladesh) - bn-BD

### App Name

Nibomo: AI ফ্ল্যাশ কার্ড

### Short Description

নোট ও ছবি থেকে ফ্ল্যাশ কার্ড বানান। সেভ করা কার্ড অফলাইনে ঝালিয়ে নিন।

### Full Description

ক্লাসের নোট, খাতার ছবি বা একটি বিষয় থেকে Nibomo-তে ফ্ল্যাশ কার্ড তৈরি করুন। নিজের ডেক বানিয়ে নিয়মিত পড়া ঝালিয়ে নিন। সেভ করা কার্ড নিয়ে ইন্টারনেট ছাড়াও পড়তে পারবেন।

পড়ার উপকরণ থেকে কার্ড বানান
নোট পেস্ট করুন বা খাতার পাতার ছবি যোগ করুন। কোন সংজ্ঞা বা উদাহরণ মনে রাখতে চান, তা AI-কে বলুন। AI-এর তৈরি প্রশ্ন ও উত্তর নিজের মতো করে বদলে নিন। চাইলে শুরু থেকেই নিজে প্রশ্ন ও উত্তর লিখুন।

বিরতি দিয়ে বারবার পড়ুন
প্রশ্ন দেখে উত্তরটা মনে করার চেষ্টা করুন। কার্ড ওল্টানোর পর জানান উত্তরটি কতটা মনে ছিল। এই পদ্ধতিকে স্পেসড রিপিটেশন বলে। কঠিন কার্ডগুলো আগে ফিরে আসে, আর সহজগুলো দেখার আগে বেশি সময় পান।

নতুন শব্দের অনুশীলন করুন
পড়তে গিয়ে বা কথা বলতে গিয়ে যে ইংরেজি শব্দগুলো পান, সেগুলো দিয়ে নিজের ফ্ল্যাশ কার্ড বানান। শব্দটি কীভাবে ব্যবহার হয়, তা মনে রাখতে একটি উদাহরণ বাক্য লিখুন। Nibomo-র ক্যাটালগে ইংরেজি ফ্রেজাল ভার্ব ও প্রাথমিক স্প্যানিশ শব্দভাণ্ডারের ডেকও আছে।

সেভ করা কার্ড অফলাইনে পড়ুন
যাতায়াতের পথে বা ক্লাসের ফাঁকে সেভ করা কার্ড খুলুন। আবার ইন্টারনেটে যুক্ত হলে অগ্রগতি সিঙ্ক হবে। একই অ্যাকাউন্টে অন্য ডিভাইস থেকেও পড়া চালিয়ে যেতে পারবেন।

AI ফিচারের জন্য ইন্টারনেট সংযোগ প্রয়োজন।

### Release notes

- Premium সাবস্ক্রিপশন নিন এবং পছন্দমতো অ্যাকসেন্ট রং বেছে নিন।
- নিজের OpenAI API কী ব্যবহার করুন এবং AI ব্যবহারের তথ্য দেখুন।
- ডেক মুছে ফেলার আগে নিশ্চিত করুন এবং উন্নত সেটিংসে আরও সহজে নেভিগেট করুন।

## Catalan - ca

### App Name

Nibomo: Flashcards amb IA

### Short Description

Crea targetes amb apunts i fotos. Fes repàs espaiat sense connexió.

### Full Description

Crea flashcards amb els teus apunts de classe, una foto o un tema que vulguis estudiar. Nibomo t’ajuda a preparar les targetes i a repassar-les amb repetició espaiada.

Converteix apunts en targetes d’estudi
Enganxa els apunts o adjunta una foto d’una pàgina de la llibreta. Demana a la IA que prepari preguntes sobre definicions, exemples o idees clau. Pots editar les respostes o fer les targetes de zero, una per una.

Recorda el que estudies
Prova de respondre de memòria i gira la targeta per comprovar la resposta. Indica si t’ha costat recordar-la. Nibomo programa el repàs següent en funció de la teva valoració i et torna a mostrar abans el que et costa més.

Practica amb targetes de vocabulari
Recull les paraules noves que trobes en una lectura o en una conversa i afegeix-hi frases d’exemple. Si vols començar amb un conjunt preparat, al catàleg de Nibomo hi ha verbs amb partícula en anglès i vocabulari bàsic en castellà.

Repassa sense connexió
Obre les targetes desades al tren o entre classes. Quan et tornis a connectar, es sincronitzaran els repassos i podràs continuar en un altre dispositiu.

Les funcions d’IA necessiten connexió a internet.

### Release notes

- Subscriu-te a Premium i personalitza els colors d’accent.
- Fes servir la teva pròpia clau API d’OpenAI i consulta l’ús de la IA.
- Confirma la supressió de baralles i mou-te més fàcilment pels ajustos.

## Czech - cs-CZ

### App Name

Nibomo: Kartičky na učení

### Short Description

Kartičky z poznámek a fotek. Opakujte s rozestupy i offline.

### Full Description

Vytvořte si v Nibomu kartičky na učení z vlastních materiálů. Z poznámek, fotky stránky v sešitu nebo zadaného tématu vám AI navrhne otázky a odpovědi. Rozložené opakování pak pomáhá udržet učivo v paměti.

Připravte si vlastní kartičky
Vložte poznámky z přednášky nebo přidejte fotku. AI můžete požádat, aby se zaměřila na pojmy, příklady nebo fakta, která potřebujete znát. Návrhy upravte podle sebe. Kartičky si také můžete napsat ručně a rozdělit do balíčků podle předmětu.

Opakujte v rozestupech
Nejdřív si zkuste odpověď vybavit, potom kartičku otočte a ohodnoťte, jak dobře jste si vzpomněli. Nibomo podle toho naplánuje další opakování. Obtížnější kartičky se objeví dřív, známé později.

Učte se slovíčka v kontextu
Přidejte slova z učebnice, knihy nebo rozhovoru a doplňte vlastní příkladové věty. V katalogu Nibomo najdete i hotové balíčky, třeba anglická frázová slovesa nebo základy španělské slovní zásoby.

Opakujte i offline
Uložené kartičky otevřete bez připojení, třeba cestou do školy. Po návratu na internet se pokrok synchronizuje mezi zařízeními.

Funkce AI vyžadují připojení k internetu.

### Release notes

- Předplaťte si Premium a přizpůsobte si barvy zvýraznění.
- Používejte vlastní API klíč OpenAI a sledujte využití AI.
- Potvrzujte mazání balíčků a snáze se orientujte v nastavení.

## Danish - da-DK

### App Name

Nibomo: Flashcards med AI

### Short Description

Lav flashcards fra noter og fotos. Repetér med mellemrum, også offline.

### Full Description

Lav flashcards med AI ud fra dit eget studiemateriale. Opret dine egne kortsæt, lær gloser, og repetér gemte kort, selv når du er offline.

Lav kort af dit eget materiale
Indsæt dine noter, vedhæft et foto af en side, eller giv AI et emne. Du får forslag til spørgsmål og svar, som du kan tilpasse. Du kan også skrive hvert kort selv.

Repetér med passende mellemrum
Prøv at huske svaret, før du vender kortet. Vurdér bagefter, hvor godt du huskede det. Nibomo bruger intervalgentagelse (spaced repetition), så du ser svære kort igen før dem, du allerede kan.

Lær gloser
Lav flashkort med nye ord fra undervisningen eller en bog, og tilføj gerne eksempler. Du kan også vælge et færdigt sæt i Nibomos katalog, f.eks. engelske udsagnsord med partikler eller spanske gloser for begyndere.

Repetér gemte kort offline. Dine fremskridt bliver synkroniseret, når du er på nettet igen. AI-funktionerne kræver internetforbindelse.

### Release notes

- Abonner på Premium, og tilpas accentfarverne.
- Brug din egen OpenAI-API-nøgle, og se dit AI-forbrug.
- Bekræft sletning af kortsæt, og find lettere rundt i indstillingerne.

## Greek - el-GR

### App Name

Nibomo: AI Flashcards

### Short Description

Φτιάξτε flashcards από σημειώσεις και φωτογραφίες. Μελέτη εκτός σύνδεσης.

### Full Description

Φτιάξτε flashcards από σημειώσεις ή φωτογραφίες, οργανώστε τις κάρτες σας σε συλλογές και κάντε επανάληψη σε διαστήματα με το Nibomo.

Δημιουργία καρτών μελέτης
Επικολλήστε τις σημειώσεις ενός μαθήματος, προσθέστε μια φωτογραφία από το τετράδιο ή περιγράψτε τι θέλετε να μάθετε. Ζητήστε από την τεχνητή νοημοσύνη να εστιάσει σε ορισμούς, παραδείγματα ή βασικές ιδέες. Επεξεργαστείτε τις προτεινόμενες ερωτήσεις και απαντήσεις ή γράψτε τις κάρτες μία προς μία.

Επανάληψη σε διαστήματα
Διαβάστε την ερώτηση και προσπαθήστε να απαντήσετε από μνήμης. Γυρίστε την κάρτα και δηλώστε πόσο εύκολα θυμηθήκατε την απάντηση. Το Nibomo προγραμματίζει την επόμενη επανάληψη βάσει της αξιολόγησής σας, ώστε οι δύσκολες κάρτες να εμφανίζονται νωρίτερα.

Κάρτες για αγγλικό και ισπανικό λεξιλόγιο
Κρατήστε σε κάρτες τις νέες λέξεις που συναντάτε στο διάβασμα ή σε μια συζήτηση. Προσθέστε ένα παράδειγμα χρήσης ή ξεκινήστε με μια έτοιμη συλλογή από τον κατάλογο του Nibomo, όπως φραστικά ρήματα στα αγγλικά ή ισπανικό λεξιλόγιο για αρχάριους.

Μελέτη εκτός σύνδεσης
Κάντε επανάληψη με τις αποθηκευμένες κάρτες στη διαδρομή ή ανάμεσα στα μαθήματα. Όταν βρεθείτε ξανά στο διαδίκτυο, συνδεθείτε στον ίδιο λογαριασμό για να συγχρονίσετε την πρόοδό σας και να συνεχίσετε από άλλη συσκευή.

Οι λειτουργίες AI απαιτούν σύνδεση στο διαδίκτυο.

### Release notes

- Εγγραφείτε στο Premium και προσαρμόστε τα χρώματα έμφασης.
- Χρησιμοποιήστε το δικό σας κλειδί API OpenAI και δείτε τη χρήση του AI.
- Επιβεβαιώστε τη διαγραφή συλλογών και περιηγηθείτε πιο εύκολα στις ρυθμίσεις.

## Estonian - et

### App Name

Nibomo: Flashcards

### Short Description

Tee märkmetest ja fotodest õpikaardid. Korda ka internetita.

### Full Description

Loo märkmetest ja fotodest õpikaardid (flashcards). Vahedega kordamine aitab õpitut meeles hoida ja sõnakaardid sobivad uue sõnavara harjutamiseks.

Tee õpikaardid enda materjalist
Kleebi märkmed rakendusse, lisa foto vihikulehest või kirjelda teemat. Tehisintellekt pakub küsimusi ja vastuseid, mida saad enne õppimist muuta. Võid ka ise kaardid algusest peale valmis kirjutada.

Korda sobivate vahedega
Proovi vastus enne kaardi ümberpööramist meelde tuletada. Seejärel hinda, kui hästi vastust mäletasid. Nibomo toob keerulisemad kaardid kordamiseks tagasi varem ja tuttavamad hiljem.

Harjuta sõnavara
Tee sõnakaardid tunnis, raamatus või vestluses kohatud sõnadest. Lisa näitelause, mis aitab sõna kasutust meelde jätta. Nibomo kataloogist leiad ka valmis kaardipakke, näiteks hispaania keele algtaseme sõnavara harjutamiseks.

Salvestatud õpikaarte saad korrata võrguühenduseta. Õppimise edenemine sünkroonitakse, kui oled uuesti võrgus. Tehisintellekti funktsioonid vajavad internetiühendust.

### Release notes

- Telli Premium ja kohanda aktsentvärve.
- Kasuta oma OpenAI API-võtit ja vaata AI kasutusandmeid.
- Kinnita kaardipakkide kustutamine ja liigu mugavamalt seadetes.

## Persian - fa

### App Name

Nibomo: ساخت فلش کارت

### Short Description

با هوش مصنوعی از جزوه و عکس فلش کارت بسازید و آفلاین مرور کنید.

### Full Description

با Nibomo از مطالب درسی‌تان فلش کارت بسازید و با تکرار فاصله‌دار مرورشان کنید. کارت‌هایی را که ذخیره کرده‌اید می‌توانید بدون اینترنت هم مرور کنید.

ساخت فلش کارت از جزوه و عکس
متن جزوه را وارد کنید، عکسی از صفحهٔ دفترتان بفرستید یا موضوعی را که می‌خواهید یاد بگیرید بنویسید. از هوش مصنوعی بخواهید برای تعریف‌ها، مثال‌ها یا نکات کلیدی پرسش و پاسخ پیشنهاد کند. قبل از مطالعه آن‌ها را ویرایش کنید یا کارت‌هایتان را خودتان یکی‌یکی بسازید.

مرور در زمان مناسب
پرسش را بخوانید و قبل از برگرداندن کارت، پاسخ را به یاد بیاورید. بعد مشخص کنید چقدر خوب آن را به یاد داشتید. زمان مرور بعدی بر اساس ارزیابی شما تعیین می‌شود و کارت‌های سخت زودتر برمی‌گردند.

تمرین لغات انگلیسی و اسپانیایی
برای واژه‌هایی که در کلاس، کتاب یا گفت‌وگو می‌بینید فلش کارت بسازید. یک جملهٔ نمونه هم اضافه کنید تا کاربرد واژه را در متن به خاطر بسپارید. در فهرست Nibomo می‌توانید با دسته‌ای آماده، مثل افعال عبارتی انگلیسی یا واژگان اسپانیایی مقدماتی، شروع کنید.

مرور آفلاین
کارت‌های ذخیره‌شده را در مسیر یا بین کلاس‌ها مرور کنید. بعد از اتصال دوباره، با همان حساب وارد شوید تا پیشرفتتان همگام شود و بتوانید در دستگاه دیگری ادامه دهید.

امکانات هوش مصنوعی به اتصال اینترنت نیاز دارند.

### Release notes

- مشترک Premium شوید و رنگ‌های تأکیدی را به سلیقهٔ خود تغییر دهید.
- از کلید API شخصی OpenAI خود استفاده کنید و میزان استفاده از هوش مصنوعی را ببینید.
- حذف دسته‌ها را تأیید کنید و راحت‌تر در تنظیمات جابه‌جا شوید.

## Finnish - fi-FI

### App Name

Nibomo: AI-muistikortit

### Short Description

Tee muistikortit muistiinpanoista ja kuvista. Kertaa myös ilman nettiä.

### Full Description

Tee omat muistikortit muistiinpanoista ja kuvista. Nibomo auttaa opiskelussa ja sanaston harjoittelussa aikavälikertauksen (spaced repetition) avulla. Voit kerrata tallennettuja kortteja myös offline-tilassa.

Tee omat muistikorttisi
Liitä luentomuistiinpanot tai kuva vihkon sivusta. Voit myös kertoa, mitä aihetta haluat harjoitella. Tekoäly ehdottaa kysymyksiä ja vastauksia, joita voit muokata. Halutessasi voit kirjoittaa kortit itse.

Kertaa sopivin välein
Yritä palauttaa vastaus mieleen, käännä sitten kortti ja arvioi, kuinka hyvin muistit. Nibomon jaksotettu kertaus tuo vaikeat kortit takaisin nopeammin ja antaa tutuille korteille pidemmän kertausvälin.

Harjoittele sanastoa
Tee sanastokortteja vastaan tulevista sanoista ja lisää omia esimerkkilauseita. Nibomon luettelosta voit valita valmiin pakan, esimerkiksi englannin fraasiverbejä tai espanjan alkeissanastoa.

Voit kerrata tallennettuja kortteja ilman verkkoyhteyttä. Edistymisesi synkronoituu, kun olet taas verkossa. Tekoälytoiminnot vaativat internetyhteyden.

### Release notes

- Tilaa Premium ja mukauta korostusvärejä.
- Käytä omaa OpenAI-API-avaintasi ja seuraa tekoälyn käyttöä.
- Vahvista pakkojen poistaminen ja löydä etsimäsi helpommin asetuksista.

## Gujarati - gu

### App Name

Nibomo: AI ફ્લેશકાર્ડ્સ

### Short Description

નોટ્સ અને ફોટામાંથી ફ્લેશકાર્ડ બનાવો. સાચવેલા કાર્ડનો ઑફલાઇન અભ્યાસ કરો.

### Full Description

નોટ્સ અને નોટબુકના ફોટામાંથી Nibomoમાં ફ્લેશકાર્ડ (flashcards) બનાવો. તમારા કાર્ડનો ડેક તૈયાર કરો, સમયાંતરે તેનો અભ્યાસ કરો અને સાચવેલા કાર્ડ ઇન્ટરનેટ વિના પણ ખોલો.

અભ્યાસની સામગ્રીમાંથી ફ્લેશકાર્ડ બનાવો
વર્ગની નોટ્સ પેસ્ટ કરો, ફોટો ઉમેરો અથવા જે વિષય શીખવો છે તે લખો. કઈ વ્યાખ્યા, ઉદાહરણ કે માહિતી યાદ રાખવી છે તે AIને જણાવો. તૈયાર થયેલા પ્રશ્નો અને જવાબો સુધારો અથવા કાર્ડ જાતે લખો.

અંતર રાખીને ફરી અભ્યાસ કરો
પહેલાં પ્રશ્ન વાંચો અને જવાબ યાદ કરવાનો પ્રયત્ન કરો. પછી કાર્ડ પલટાવો અને તમને કેટલું યાદ આવ્યું તે જણાવો. સ્પેસ્ડ રિપીટિશન એટલે સમયાંતરે પુનરાવર્તન. જે કાર્ડ અઘરા લાગે તે વહેલા ફરી દેખાય છે.

અંગ્રેજી શબ્દભંડોળ વધારો
વાંચવામાં કે વાતચીતમાં મળેલા અંગ્રેજી શબ્દો માટે પોતાના ફ્લેશકાર્ડ બનાવો. વાક્યમાં શબ્દ કેવી રીતે વપરાય છે તે યાદ રાખવા તમારું ઉદાહરણ ઉમેરો. Nibomoના કૅટલૉગમાં અંગ્રેજી ફ્રેઝલ વર્બ્સ અને શરૂઆતના સ્તરના સ્પેનિશ શબ્દોના તૈયાર ડેક પણ છે.

સાચવેલા કાર્ડનો ઑફલાઇન અભ્યાસ કરો
મુસાફરીમાં કે વર્ગો વચ્ચે સમય મળે ત્યારે સાચવેલા કાર્ડ ફરી જુઓ. ઇન્ટરનેટ પાછું મળે ત્યારે પ્રગતિ સિંક થાય છે. પછી એ જ એકાઉન્ટથી બીજા ડિવાઇસ પર અભ્યાસ ચાલુ રાખી શકો છો.

AI સુવિધાઓ માટે ઇન્ટરનેટ જરૂરી છે.

### Release notes

- Premiumનું સબ્સ્ક્રિપ્શન લો અને તમારી પસંદના એક્સેન્ટ રંગો પસંદ કરો.
- તમારી પોતાની OpenAI API કી વાપરો અને AI વપરાશ જુઓ.
- ડેક કાઢી નાખતાં પહેલાં પુષ્ટિ કરો અને સુધારેલી સેટિંગ્સમાં વધુ સરળતાથી નેવિગેટ કરો.

## Hebrew - iw-IL

### App Name

Nibomo: כרטיסיות לימוד עם AI

### Short Description

הפכו סיכומים ותמונות לכרטיסיות. חזרו עליהן במרווחים, גם ללא אינטרנט.

### Full Description

צרו כרטיסיות לימוד מהחומר שלכם, תרגלו אוצר מילים והשתמשו בחזרה מרווחת כדי לזכור את מה שלמדתם לאורך זמן.

יצירת כרטיסיות מסיכומים ומתמונות
הדביקו סיכום משיעור, צרפו תמונה מהמחברת או כתבו איזה נושא תרצו ללמוד. בקשו מהבינה המלאכותית להתמקד בהגדרות, בדוגמאות או בנקודות החשובות. תוכלו לערוך את השאלות והתשובות שהיא מציעה או להכין את הכרטיסיות בעצמכם.

חזרה מרווחת לפי קצב הלימוד שלכם
קראו את השאלה ונסו לשלוף את התשובה מהזיכרון. הפכו את הכרטיסייה וסמנו עד כמה זכרתם. לפי הדירוג שלכם, Nibomo יחזיר כרטיסיות קשות מוקדם יותר וירווח את החזרות על מה שכבר מוכר לכם.

תרגול אוצר מילים באנגלית ובספרדית
אספו מילים שנתקלתם בהן בקריאה או בשיחה והוסיפו לכל כרטיסייה משפט לדוגמה. אפשר גם להתחיל מחפיסה מוכנה מהקטלוג של Nibomo, כמו פעלים צירופיים באנגלית או אוצר מילים בספרדית למתחילים.

חזרה ללא אינטרנט
חזרו על הכרטיסיות השמורות בדרך או בין שיעורים. כשתחזרו לאינטרנט, היכנסו לאותו חשבון כדי לסנכרן את ההתקדמות ולהמשיך ממכשיר אחר.

תכונות הבינה המלאכותית דורשות חיבור לאינטרנט.

### Release notes

- הירשמו ל-Premium והתאימו אישית את צבעי ההדגשה.
- השתמשו במפתח API משלכם ל-OpenAI וצפו בנתוני השימוש ב-AI.
- אשרו מחיקת חפיסות ונווטו בקלות רבה יותר בהגדרות.

## Croatian - hr

### App Name

Nibomo: Kartice za učenje

### Short Description

Izradi kartice iz bilješki i fotografija. Ponavljaj ih u razmacima i offline.

### Full Description

Izradi kartice za učenje iz vlastitog gradiva u Nibomu. Pretvori bilješke, fotografiju stranice ili zadanu temu u kartice s pitanjima i odgovorima pa ih ponavljaj u razmacima.

Pretvori bilješke u kartice
Zalijepi bilješke s predavanja ili dodaj fotografiju iz bilježnice. AI može predložiti pitanja o pojmovima, primjerima i činjenicama koje želiš zapamtiti. Uredi prijedloge prema svojim potrebama ili od početka napiši vlastite kartice i složi ih u špilove.

Ponavljaj u pravom trenutku
Prvo pokušaj odgovoriti, a zatim okreni karticu i ocijeni koliko se dobro sjećaš odgovora. Ponavljanje s razmacima, poznato i kao spaced repetition, vraća teže kartice ranije, a one koje dobro znaš kasnije.

Vježbaj nove riječi
Izradi kartice za učenje vokabulara od riječi koje čuješ na nastavi ili pronađeš u knjizi. Dodaj vlastite primjere ili počni s gotovim špilom iz kataloga Nibomo, kao što su engleski frazni glagoli ili španjolske riječi za početnike.

Ponavljaj spremljene kartice bez interneta
Otvori ih kad uhvatiš nekoliko slobodnih minuta. Kad se ponovno povežeš, napredak se sinkronizira između uređaja.

Za značajke koje koriste AI potrebna je internetska veza.

### Release notes

- Pretplati se na Premium i prilagodi boje naglaska.
- Koristi vlastiti OpenAI API ključ i prati korištenje AI-ja.
- Potvrdi brisanje špilova i lakše se snađi u postavkama.

## Hungarian - hu-HU

### App Name

Nibomo: Tanulókártya-készítő

### Short Description

Készíts tanulókártyákat jegyzetből és fotóból, és ismételj offline is.

### Full Description

Készíts tanulókártyákat a saját tananyagodhoz a Nibomo segítségével. Állíts össze paklikat jegyzetekből vagy fotókból, majd az időközönkénti ismétléssel gyakorold, amit szeretnél megjegyezni.

Tanulókártyák jegyzetből és fotóból
Másold be az órai jegyzetedet, csatolj egy fotót a füzetedről, vagy írd le, mit szeretnél megtanulni. Kérhetsz az AI-tól kérdés-válasz párokat a fontos fogalmakhoz vagy példákhoz. A javaslatokat átírhatod, és saját kártyákat is készíthetsz egyenként.

Időközönkénti ismétlés a saját tempódban
Olvasd el a kérdést, és próbálj emlékezetből válaszolni. Fordítsd meg a kártyát, majd jelöld, mennyire ment könnyen. A Nibomo ehhez igazítja a következő ismétlést. A nehéz kártyák hamarabb kerülnek újra elő, a jól ismert kártyák ritkábban.

Angol szókártyák és spanyol szókincs
Készíts kártyákat azokhoz a szavakhoz, amelyekkel olvasás vagy beszélgetés közben találkozol. Példamondatot is adhatsz hozzá, hogy a szó használatát is megjegyezd. Választhatsz kész paklit is a Nibomo katalógusából, például angol igekötős igékhez vagy kezdő spanyol szavakhoz.

Ismétlés offline
A mentett kártyákat útközben és órák között is átismételheted. Ha újra van interneted, jelentkezz be ugyanazzal a fiókkal a haladásod szinkronizálásához, és folytasd akár egy másik eszközön.

Az AI-funkciókhoz internetkapcsolat szükséges.

### Release notes

- Fizess elő a Premiumra, és szabd személyre a kiemelőszíneket.
- Használd a saját OpenAI API-kulcsodat, és kövesd az AI-használatodat.
- Erősítsd meg a paklik törlését, és igazodj el könnyebben a beállításokban.

## Indonesian - id

### App Name

Nibomo: Pembuat Flashcard AI

### Short Description

Buat flashcard dari catatan dan foto. Ulangi kartu tersimpan secara offline.

### Full Description

Buat flashcard dari catatan, foto, atau topik yang sedang kamu pelajari. Dengan Nibomo, kamu bisa membuat dek sendiri, mengulang materi dengan pengulangan berjarak, dan melanjutkan belajar secara offline setelah kartumu tersimpan.

Dari catatan atau foto menjadi flashcard
Tempel catatan kuliah, lampirkan foto halaman buku, atau jelaskan topik yang ingin kamu pelajari. Minta AI menyusun pertanyaan dan jawaban dari definisi, contoh, atau fakta penting. Edit hasilnya sebelum belajar atau buat kartu sendiri satu per satu.

Ingat materi lebih lama
Baca pertanyaan dan coba jawab dari ingatan. Balik kartu, lalu beri nilai sesuai seberapa baik kamu mengingat jawabannya. Nibomo menggunakan pengulangan berjarak untuk menentukan jadwal berikutnya. Kartu yang sulit muncul lebih cepat, sementara kartu yang sudah kamu kuasai mendapat jeda lebih panjang.

Latih kosakata dengan flashcard
Buat kartu untuk kata yang kamu temui di kelas, di buku, atau saat mengobrol. Tambahkan contoh kalimat untuk mengingat cara memakai setiap kata. Kamu juga bisa memakai dek siap pakai dari katalog Nibomo, seperti phrasal verbs bahasa Inggris atau kosakata bahasa Spanyol untuk pemula.

Ulangi kartu secara offline
Buka kartu yang sudah tersimpan saat menunggu atau dalam perjalanan tanpa internet. Masuk dengan akunmu untuk menyinkronkan progres belajar antarperangkat saat kembali online.

Fitur AI memerlukan koneksi internet.

### Release notes

- Berlangganan Premium dan sesuaikan warna aksen.
- Gunakan kunci API OpenAI milikmu sendiri dan lihat penggunaan AI.
- Konfirmasikan penghapusan dek dan jelajahi pengaturan dengan lebih mudah.

## Icelandic - is-IS

### App Name

Nibomo: Flashcards

### Short Description

Búðu til minnisspjöld úr glósum og myndum. Rifjaðu upp án nets.

### Full Description

Búðu til minnisspjöld (flashcards) úr eigin glósum og myndum. Rifjaðu námsefnið upp með reglulegu millibili og notaðu orðaspjöld til að auka orðaforðann.

Búðu til þín eigin minnisspjöld
Límdu inn glósur, bættu við mynd af síðu eða lýstu viðfangsefni. Gervigreindin stingur upp á spurningum og svörum sem þú getur lagað að þínu námi. Þú getur líka skrifað spjöldin frá grunni.

Rifjaðu upp með millibili
Reyndu að muna svarið áður en þú snýrð spjaldinu við. Gefðu svo til kynna hversu vel þú mundir svarið. Nibomo ákveður hvenær þú sérð spjaldið næst. Erfið spjöld birtast fyrr en þau sem þú kannt vel.

Æfðu orðaforðann
Settu orð úr kennslustund, bók eða samtali á spjöld og bættu við dæmasetningum. Í safni Nibomo eru líka tilbúnir spjaldapakkar, til dæmis algeng spænsk orð og orðasambönd fyrir byrjendur.

Opnaðu vistuð spjöld án nettengingar. Framvindan samstillist þegar þú tengist netinu aftur. Gervigreindin þarf nettengingu.

### Release notes

- Gerstu áskrifandi að Premium og sérsníddu áhersluliti.
- Notaðu þinn eigin OpenAI API-lykil og skoðaðu notkun gervigreindar.
- Staðfestu eyðingu kortastokka og farðu auðveldlega um endurbættar stillingar.

## Italian - it-IT

### App Name

Nibomo: Flashcard con IA

### Short Description

Crea flashcard da appunti e foto. Ripassa offline con ripetizione spaziata.

### Full Description

Trasforma gli appunti di lezione e le foto del quaderno in flashcard. Con il generatore di flashcard di Nibomo puoi preparare un mazzo per ripassare gli argomenti che ti interessano.

Dagli appunti alle domande
Incolla gli appunti, allega una foto o descrivi l’argomento che vuoi imparare. Chiedi all’IA di concentrarsi sulle definizioni, sugli esempi o sui concetti chiave. Controlla le domande e modifica le risposte prima di studiare. Puoi anche creare una scheda alla volta, a mano.

Ripassa con la ripetizione dilazionata
Leggi la domanda e prova a rispondere senza guardare. Gira la flashcard e indica quanto bene ricordavi la risposta. Nibomo calcola il prossimo ripasso e fa tornare prima le schede più difficili.

Impara i vocaboli inglesi
Crea flashcard con le parole che incontri a lezione, nei libri o in una conversazione. Aggiungi esempi per ricordare come si usano. Nel catalogo trovi anche mazzi pronti, per esempio sui verbi frasali inglesi e sul lessico spagnolo di base.

Ripassa le flashcard offline
Apri le schede già salvate anche senza connessione. Quando torni online, i ripassi si sincronizzano e puoi continuare su un altro dispositivo.

Le funzioni di IA richiedono una connessione a Internet.

### Release notes

- Abbonati a Premium e personalizza i colori di risalto.
- Usa la tua chiave API OpenAI e consulta l’utilizzo dell’IA.
- Conferma l’eliminazione dei mazzi e naviga più facilmente nelle impostazioni.

## Kannada (India) - kn-IN

### App Name

Nibomo: Make AI Flashcards

### Short Description

ಟಿಪ್ಪಣಿ ಮತ್ತು ಫೋಟೋಗಳಿಂದ AI ಬಳಸಿ ಕಾರ್ಡ್ ಮಾಡಿ. ಆಫ್‌ಲೈನ್‌ನಲ್ಲೂ ಓದಿ.

### Full Description

ತರಗತಿಯ ಟಿಪ್ಪಣಿಗಳು, ನೋಟ್‌ಬುಕ್ ಪುಟದ ಫೋಟೋ ಅಥವಾ ಓದಲು ಬಯಸುವ ವಿಷಯದಿಂದ Nibomoದಲ್ಲಿ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳನ್ನು ರಚಿಸಿ. ಅಂತರವಿಟ್ಟು ಮರುಅಭ್ಯಾಸ ಮಾಡಿ. ಕಾರ್ಡ್‌ಗಳನ್ನು ಉಳಿಸಿಕೊಂಡಿದ್ದರೆ ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದಾಗಲೂ ಓದಬಹುದು.

ಟಿಪ್ಪಣಿಗಳಿಂದ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳು
ನೆನಪಿಟ್ಟುಕೊಳ್ಳಬೇಕಾದ ವ್ಯಾಖ್ಯಾನಗಳು, ಉದಾಹರಣೆಗಳು ಅಥವಾ ಮುಖ್ಯ ಅಂಶಗಳ ಮೇಲೆ ಗಮನ ಕೊಡಲು AIಗೆ ಕೇಳಿ. ಅದು ಸಿದ್ಧಪಡಿಸಿದ ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರಗಳನ್ನು ನಿಮಗೆ ಸರಿಹೊಂದುವಂತೆ ತಿದ್ದಿಕೊಳ್ಳಿ. ಬಯಸಿದರೆ ನಿಮ್ಮದೇ ಕಾರ್ಡ್‌ಗಳನ್ನು ಒಂದೊಂದಾಗಿ ಬರೆಯಿರಿ.

ಅಂತರವಿಟ್ಟು ಪುನರಾವರ್ತನೆ (spaced repetition)
ಪ್ರಶ್ನೆ ಓದಿ ಉತ್ತರವನ್ನು ನೆನಪಿಸಿಕೊಳ್ಳಲು ಪ್ರಯತ್ನಿಸಿ. ಕಾರ್ಡ್ ತಿರುಗಿಸಿದ ಮೇಲೆ ನಿಮಗೆ ಉತ್ತರ ಎಷ್ಟು ಚೆನ್ನಾಗಿ ನೆನಪಿತ್ತು ಎಂದು ದಾಖಲಿಸಿ. Nibomo ಅದರ ಆಧಾರದ ಮೇಲೆ ಮುಂದಿನ ಮರುಅಭ್ಯಾಸವನ್ನು ನಿಗದಿಪಡಿಸುತ್ತದೆ. ಕಷ್ಟವಾದ ಕಾರ್ಡ್‌ಗಳು ಬೇಗ ಬರುತ್ತವೆ. ಚೆನ್ನಾಗಿ ನೆನಪಿರುವ ಕಾರ್ಡ್‌ಗಳು ಹೆಚ್ಚಿನ ಅಂತರದ ನಂತರ ಬರುತ್ತವೆ.

ಇಂಗ್ಲಿಷ್ ಪದಗಳ ಅಭ್ಯಾಸ
ತರಗತಿಯಲ್ಲಿ, ಪುಸ್ತಕದಲ್ಲಿ ಅಥವಾ ಮಾತುಕತೆಯಲ್ಲಿ ಸಿಕ್ಕ ಹೊಸ ಪದಗಳಿಗೆ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳನ್ನು ಮಾಡಿ. ನಿಮ್ಮದೇ ಉದಾಹರಣೆ ವಾಕ್ಯಗಳನ್ನು ಸೇರಿಸಿ. Nibomo ಸಂಗ್ರಹದಲ್ಲಿ ಇಂಗ್ಲಿಷ್ ಫ್ರೇಸಲ್ ವರ್ಬ್‌ಗಳು ಮತ್ತು ಆರಂಭಿಕ ಸ್ಪ್ಯಾನಿಷ್ ಪದಗಳ ಸಿದ್ಧ ಕಾರ್ಡ್‌ಗಳೂ ಇವೆ.

ಉಳಿಸಿದ ಫ್ಲ್ಯಾಶ್‌ಕಾರ್ಡ್‌ಗಳನ್ನು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಓದಿ
ಪ್ರಯಾಣದಲ್ಲೋ ತರಗತಿಗಳ ನಡುವೆಯೋ ಕೆಲವು ನಿಮಿಷ ಸಿಕ್ಕಾಗ ಕಾರ್ಡ್‌ಗಳನ್ನು ಮರುಅಭ್ಯಾಸ ಮಾಡಿ. ಇಂಟರ್ನೆಟ್‌ಗೆ ಮತ್ತೆ ಸಂಪರ್ಕಿಸಿದಾಗ ನಿಮ್ಮ ಪ್ರಗತಿ ಸಿಂಕ್ ಆಗುತ್ತದೆ.

AI ವೈಶಿಷ್ಟ್ಯಗಳಿಗೆ ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಬೇಕು.

### Release notes

- Premium ಚಂದಾದಾರರಾಗಿ ಮತ್ತು ನಿಮ್ಮ ಇಷ್ಟದ ಅಕ್ಸೆಂಟ್ ಬಣ್ಣಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ.
- ನಿಮ್ಮದೇ OpenAI API ಕೀ ಬಳಸಿ ಮತ್ತು AI ಬಳಕೆಯನ್ನು ವೀಕ್ಷಿಸಿ.
- ಡೆಕ್ ಅಳಿಸುವ ಮೊದಲು ದೃಢೀಕರಿಸಿ ಮತ್ತು ಸುಧಾರಿತ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಸುಲಭವಾಗಿ ನ್ಯಾವಿಗೇಟ್ ಮಾಡಿ.

## Korean - ko-KR

### App Name

Nibomo: AI 암기카드 만들기

### Short Description

노트와 사진으로 암기카드를 만들고 간격 반복으로 복습하세요. 저장한 카드는 오프라인에서도 열 수 있어요.

### Full Description

수업 노트와 사진을 암기카드로 바꿔 보세요. Nibomo로 내 카드 모음을 만들고, 간격 반복으로 복습하고, 저장한 카드는 인터넷 없이도 공부할 수 있어요.

노트와 사진으로 플래시카드 만들기
수업 노트를 붙여 넣거나 공책 사진을 첨부하세요. 공부하고 싶은 주제를 입력해도 돼요. 꼭 기억할 개념이나 예시를 알려 주면 AI가 질문과 답의 초안을 만들어 줘요. 원하는 대로 고치거나 한 장씩 직접 작성하세요.

간격 반복으로 오래 기억하기
앞면의 질문을 읽고 답을 먼저 떠올려 보세요. 카드를 뒤집어 답을 확인한 뒤 얼마나 잘 기억했는지 표시하세요. Nibomo는 그 결과에 따라 다음 복습을 정해요. 어려운 카드는 더 빨리, 익숙한 카드는 더 나중에 다시 나와요.

영단어와 스페인어 어휘 연습하기
수업, 독서, 대화에서 만난 단어를 모아 나만의 단어장을 만들어 보세요. 직접 예문을 넣으면 단어가 문장에서 어떻게 쓰이는지도 함께 익힐 수 있어요. Nibomo 카탈로그에서 영어 구동사나 스페인어 입문 어휘 카드 모음을 골라 시작해도 좋아요.

저장한 암기카드를 오프라인으로 복습하기
이동 중이나 쉬는 시간에 저장한 카드를 몇 장씩 복습하세요. 다시 연결되면 복습 진도를 동기화해 다른 기기에서도 이어서 공부할 수 있어요.

AI 기능은 인터넷 연결이 필요해요.

### Release notes

- Premium을 구독하고 강조 색상을 원하는 대로 설정하세요.
- 나만의 OpenAI API 키를 사용하고 AI 사용량을 확인하세요.
- 덱을 삭제하기 전에 확인하고, 개선된 설정을 더 편리하게 이용하세요.

## Lithuanian - lt

### App Name

Nibomo: Flashcards

### Short Description

Kurkite mokymosi korteles iš užrašų ir nuotraukų. Kartokite be interneto.

### Full Description

Kurkite mokymosi korteles (flashcards) iš savo užrašų ir nuotraukų. Intervalinis kartojimas padeda išlaikyti atmintyje tai, ką išmokote, ir įsiminti naujus žodžius.

Paverskite mokymosi medžiagą kortelėmis
Įklijuokite paskaitos užrašus, pridėkite sąsiuvinio puslapio nuotrauką arba apibūdinkite temą. Dirbtinis intelektas (DI) pasiūlys klausimų ir atsakymų. Galite juos pataisyti arba korteles parašyti patys.

Kartokite tinkamais intervalais
Pamėginkite prisiminti atsakymą prieš apversdami kortelę. Tada įvertinkite, kaip gerai jį prisiminėte. Pagal jūsų įvertinimą „Nibomo“ suplanuoja kitą kartojimą: sunkesnes korteles parodo anksčiau, o gerai žinomas – vėliau.

Mokykitės anglų ir ispanų kalbų žodžių
Kurkite žodžių korteles iš pamokose, knygose ar pokalbiuose sutiktų žodžių. Pridėkite sakinių pavyzdžių, kad prisimintumėte, kaip vartoti žodį. „Nibomo“ kataloge yra ir paruoštų rinkinių, pavyzdžiui, ispanų kalbos žodžių pradedantiesiems.

Išsaugotas korteles galite kartoti be interneto. Kai vėl prisijungsite prie interneto, jūsų pažanga bus sinchronizuota. DI funkcijoms reikia interneto ryšio.

### Release notes

- Prenumeruokite Premium ir pasirinkite akcentų spalvas.
- Naudokite savo OpenAI API raktą ir peržiūrėkite DI naudojimo duomenis.
- Patvirtinkite kaladžių ištrynimą ir lengviau naršykite nustatymus.

## Latvian - lv

### App Name

Nibomo: Flashcards

### Short Description

Veido mācību kartītes no piezīmēm un fotogrāfijām. Atkārto bezsaistē.

### Full Description

Pārvērt piezīmes un fotogrāfijas mācību kartītēs (flashcards). Atkārto apgūto ar intervāliem un veido vārdu kartītes, lai papildinātu vārdu krājumu.

Veido kartītes no sava mācību materiāla
Ielīmē piezīmes, pievieno burtnīcas lapas fotoattēlu vai apraksti tematu. Mākslīgais intelekts (MI) piedāvās jautājumus un atbildes. Vari tos labot vai uzrakstīt kartītes pats.

Atkārto ar piemērotiem intervāliem
Mēģini atcerēties atbildi, pirms apgriez kartīti. Pēc tam novērtē, cik labi to atcerējies. Nibomo ieplāno nākamo atkārtošanas reizi: grūtākas kartītes parādās ātrāk, labi apgūtās – vēlāk.

Papildini vārdu krājumu
Izveido kartītes vārdiem, ko esi dzirdējis stundā vai sarunā vai izlasījis grāmatā. Pievieno teikuma piemēru, lai atcerētos, kā vārdu lietot. Nibomo katalogā ir arī gatavi komplekti, piemēram, spāņu valodas vārdi un frāzes iesācējiem.

Saglabātās kartītes vari atkārtot bez interneta. Kad savienojums ir atjaunots, Nibomo sinhronizē tavu progresu. MI funkcijām nepieciešams interneta savienojums.

### Release notes

- Abonē Premium un pielāgo akcenta krāsas.
- Izmanto savu OpenAI API atslēgu un skati MI lietojuma datus.
- Apstiprini kartīšu komplektu dzēšanu un ērtāk pārvietojies iestatījumos.

## Malayalam (India) - ml-IN

### App Name

Nibomo: Make AI Flashcards

### Short Description

കുറിപ്പും ഫോട്ടോയും AI ഉപയോഗിച്ച് കാർഡുകളാക്കൂ. ഓഫ്‌ലൈനിലും പഠിക്കൂ.

### Full Description

ക്ലാസിലെ കുറിപ്പുകളോ നോട്ട്ബുക്കിലെ ഒരു പേജിന്റെ ഫോട്ടോയോ പഠിക്കാനുള്ള വിഷയമോ Nibomo ഉപയോഗിച്ച് ഫ്ലാഷ് കാർഡുകളാക്കൂ. ഇടവിട്ട് ആവർത്തിച്ച് പഠിക്കൂ. സേവ് ചെയ്ത കാർഡുകൾ ഇന്റർനെറ്റ് ഇല്ലാത്തപ്പോഴും തുറക്കാം.

കുറിപ്പുകളിൽ നിന്ന് ഫ്ലാഷ് കാർഡുകൾ
ഓർത്തിരിക്കേണ്ട നിർവചനങ്ങളും ഉദാഹരണങ്ങളും പ്രധാന വിവരങ്ങളും ഉൾപ്പെടുത്തി ചോദ്യങ്ങളും ഉത്തരങ്ങളും തയ്യാറാക്കാൻ AIയോട് പറയൂ. തയ്യാറായ കാർഡുകൾ നിങ്ങൾക്ക് മനസ്സിലാകുന്ന രീതിയിൽ തിരുത്തൂ. ഓരോ ഫ്ലാഷ് കാർഡും സ്വന്തമായി എഴുതാനും കഴിയും.

ഇടവിട്ട ആവർത്തനം (spaced repetition)
ചോദ്യം വായിച്ച് ഉത്തരം ഓർത്തെടുക്കാൻ ശ്രമിക്കൂ. കാർഡ് മറിച്ച ശേഷം ഉത്തരം എത്ര നന്നായി ഓർമ വന്നു എന്ന് രേഖപ്പെടുത്തൂ. അതനുസരിച്ച് അടുത്ത ആവർത്തനം Nibomo നിശ്ചയിക്കും. പ്രയാസമുള്ള കാർഡുകൾ വേഗത്തിലും നന്നായി ഓർമയുള്ളവ കൂടുതൽ ഇടവേളയ്ക്കു ശേഷവും വീണ്ടും വരും.

പദാവലി പരിശീലിക്കൂ
ക്ലാസിലോ പുസ്തകത്തിലോ സംഭാഷണത്തിലോ കാണുന്ന പുതിയ വാക്കുകൾക്ക് കാർഡുകൾ ഉണ്ടാക്കൂ. അവ ഉപയോഗിക്കുന്ന രീതി ഓർക്കാൻ സ്വന്തം ഉദാഹരണ വാക്യങ്ങൾ ചേർക്കൂ. ഇംഗ്ലീഷ് ഫ്രേസൽ വെർബുകൾക്കും തുടക്കക്കാർക്കുള്ള സ്പാനിഷ് വാക്കുകൾക്കും Nibomo ശേഖരത്തിൽ റെഡിമെയ്ഡ് കാർഡുകളുണ്ട്.

സേവ് ചെയ്ത കാർഡുകൾ ഓഫ്‌ലൈനിൽ ആവർത്തിക്കൂ
യാത്രയ്ക്കിടയിലോ ക്ലാസുകൾക്കിടയിലോ കിട്ടുന്ന കുറച്ച് സമയം പഠിക്കാൻ ഉപയോഗിക്കൂ. ഇന്റർനെറ്റ് വീണ്ടും ലഭിക്കുമ്പോൾ പഠന പുരോഗതി സിങ്ക് ചെയ്യും.

AI ഫീച്ചറുകൾക്ക് ഇന്റർനെറ്റ് ആവശ്യമാണ്.

### Release notes

- Premium സബ്‌സ്‌ക്രൈബ് ചെയ്ത് ഇഷ്ടമുള്ള ആക്സന്റ് നിറങ്ങൾ തിരഞ്ഞെടുക്കൂ.
- സ്വന്തം OpenAI API കീ ഉപയോഗിക്കൂ, AI ഉപയോഗം കാണൂ.
- ഡെക്കുകൾ ഇല്ലാതാക്കുന്നതിന് മുമ്പ് സ്ഥിരീകരിക്കൂ, മെച്ചപ്പെടുത്തിയ ക്രമീകരണങ്ങൾ കൂടുതൽ എളുപ്പത്തിൽ ഉപയോഗിക്കൂ.

## Marathi (India) - mr-IN

### App Name

Nibomo: AI फ्लॅशकार्ड

### Short Description

नोट्स व फोटोंपासून फ्लॅशकार्ड तयार करा. जतन केलेल्या कार्डांची ऑफलाइन उजळणी करा.

### Full Description

वर्गातल्या नोट्स, वहीच्या पानाचा फोटो किंवा एखादा विषय वापरून Nibomoमध्ये फ्लॅशकार्ड (flashcards) तयार करा. स्वतःचा डेक बनवा. कार्डे जतन केली की इंटरनेट नसतानाही त्यांची उजळणी करता येते.

नोट्समधून फ्लॅशकार्ड तयार करा
नोट्स पेस्ट करा किंवा फोटो जोडा. कोणत्या व्याख्या, उदाहरणे किंवा मुद्दे लक्षात ठेवायचे आहेत ते AIला सांगा. तयार झालेले प्रश्न आणि उत्तरे आपल्या शब्दांत बदलून घ्या. हवे असल्यास प्रत्येक कार्ड स्वतः लिहा.

ठरावीक अंतराने उजळणी करा
प्रश्न पाहून आधी उत्तर आठवून पाहा. कार्ड उलटल्यावर उत्तर किती चांगले आठवले ते नोंदवा. स्पेस्ड रिपिटिशनमध्ये या नोंदीवरून पुढची उजळणी कधी करायची ते ठरते. अवघड कार्डे लवकर, तर परिचित कार्डे जास्त अंतराने दिसतात.

इंग्रजी शब्दसंग्रह वाढवा
पुस्तकात किंवा बोलताना सापडलेल्या नव्या इंग्रजी शब्दांसाठी कार्डे बनवा. एखादा शब्द कुठे वापरायचा हे लक्षात ठेवण्यासाठी स्वतःचे उदाहरण वाक्य लिहा. Nibomoच्या कॅटलॉगमध्ये इंग्रजी फ्रेझल व्हर्ब्स आणि प्राथमिक स्पॅनिश शब्दांसाठी तयार डेकही आहेत.

जतन केलेल्या कार्डांची ऑफलाइन उजळणी करा
प्रवासात किंवा वर्गांच्या मध्ये थोडा वेळ मिळाला तर जतन केलेली कार्डे उघडा. इंटरनेटशी पुन्हा जोडल्यावर प्रगती सिंक होते. त्याच खात्याने दुसऱ्या डिव्हाइसवर पुढचा अभ्यास करता येतो.

AI सुविधांसाठी इंटरनेट आवश्यक आहे.

### Release notes

- Premiumचे सदस्यत्व घ्या आणि तुमच्या आवडीचे अ‍ॅक्सेंट रंग निवडा.
- तुमची स्वतःची OpenAI API की वापरा आणि AIचा वापर पाहा.
- डेक हटवण्यापूर्वी पुष्टी करा आणि सुधारित सेटिंग्जमध्ये अधिक सहजपणे नेव्हिगेट करा.

## Dutch - nl-NL

### App Name

Nibomo: Flashcards met AI

### Short Description

Maak flashcards van notities en foto’s. Herhaal met tussenpozen, ook offline.

### Full Description

Maak met Nibomo je eigen flashcards van aantekeningen, foto’s of een onderwerp. Gebruik gespreide herhaling om lesstof en woordjes te leren, en oefen met opgeslagen kaarten als je offline bent.

Maak flitskaarten van je eigen lesstof
Plak je aantekeningen, voeg een foto van een bladzijde toe of beschrijf een onderwerp. AI stelt vragen en antwoorden voor die je kunt aanpassen. Je kunt je kaarten ook één voor één zelf maken.

Herhaal met passende tussenpozen
Probeer het antwoord te bedenken voordat je de kaart omdraait. Geef daarna aan hoe goed je het antwoord wist. Nibomo gebruikt gespreide herhaling (spaced repetition). Lastige kaarten krijg je sneller terug, bekende kaarten pas later.

Oefen je woordenschat
Maak kaartjes met woorden uit de les, een boek of een gesprek. Voeg een voorbeeldzin toe om te oefenen hoe je het woord gebruikt. In de Nibomo-catalogus staan ook kant-en-klare sets, bijvoorbeeld met Engelse phrasal verbs of Spaanse woordjes voor beginners.

Open opgeslagen kaarten offline. Je voortgang wordt gesynchroniseerd zodra je weer online bent. Voor AI-functies heb je internet nodig.

### Release notes

- Abonneer je op Premium en pas de accentkleuren aan.
- Gebruik je eigen OpenAI-API-sleutel en bekijk je AI-gebruik.
- Bevestig het verwijderen van kaartensets en vind makkelijker je weg in de instellingen.

## Norwegian - no-NO

### App Name

Nibomo: Flashcards med KI

### Short Description

Lag flashcards av notater og bilder. Repeter med mellomrom, også uten nett.

### Full Description

Lag flashcards med KI fra notater, bilder eller et tema. Nibomo hjelper deg å repetere det du har lært og trene ordforrådet, også når du har lagret kortene og er uten nett.

Lag dine egne puggekort
Lim inn notater, legg ved et bilde av en side, eller beskriv et tema. KI kan foreslå spørsmål og svar. Du kan redigere forslagene eller skrive kortene selv.

Repeter med passe mellomrom
Prøv å svare før du snur kortet. Vurder så hvor godt du husket svaret. Med spredt repetisjon (spaced repetition) kommer vanskelige kort tilbake tidligere, mens du kan vente lenger med dem du kan godt.

Øv på gloser
Lag kort med ord fra undervisningen, en bok eller en samtale. Legg gjerne til en setning som viser hvordan ordet brukes. I Nibomo-katalogen finner du også ferdige kortsett, for eksempel engelske partikkelverb eller spanske gloser for nybegynnere.

Åpne lagrede kort når du er offline. Fremgangen din synkroniseres når du er på nett igjen. KI-funksjoner krever nettilkobling.

### Release notes

- Abonner på Premium og tilpass aksentfargene.
- Bruk din egen OpenAI-API-nøkkel og se KI-bruken din.
- Bekreft sletting av kortstokker og finn lettere frem i innstillingene.

## Punjabi - pa

### App Name

Nibomo: AI ਫਲੈਸ਼ ਕਾਰਡ

### Short Description

ਨੋਟਾਂ ਤੇ ਫੋਟੋਆਂ ਤੋਂ ਫਲੈਸ਼ ਕਾਰਡ ਬਣਾਓ। ਸੇਵ ਕੀਤੇ ਕਾਰਡ ਆਫਲਾਈਨ ਦੁਹਰਾਓ।

### Full Description

ਜਮਾਤ ਦੇ ਨੋਟਾਂ, ਕਾਪੀ ਦੇ ਸਫ਼ੇ ਦੀ ਫੋਟੋ ਜਾਂ ਕਿਸੇ ਵਿਸ਼ੇ ਤੋਂ Nibomo ਵਿੱਚ ਫਲੈਸ਼ ਕਾਰਡ (flashcards) ਬਣਾਓ। ਆਪਣਾ ਡੈੱਕ ਤਿਆਰ ਕਰੋ ਅਤੇ ਸੇਵ ਕੀਤੇ ਕਾਰਡ ਇੰਟਰਨੈੱਟ ਤੋਂ ਬਿਨਾਂ ਵੀ ਪੜ੍ਹੋ।

ਨੋਟਾਂ ਤੋਂ ਫਲੈਸ਼ ਕਾਰਡ ਬਣਾਓ
ਨੋਟ ਪੇਸਟ ਕਰੋ ਜਾਂ ਫੋਟੋ ਜੋੜੋ। AI ਨੂੰ ਦੱਸੋ ਕਿ ਤੁਸੀਂ ਕਿਹੜੀਆਂ ਪਰਿਭਾਸ਼ਾਵਾਂ, ਉਦਾਹਰਨਾਂ ਜਾਂ ਮੁੱਖ ਗੱਲਾਂ ਯਾਦ ਰੱਖਣੀਆਂ ਹਨ। ਤਿਆਰ ਸਵਾਲ ਤੇ ਜਵਾਬ ਆਪਣੀ ਲੋੜ ਮੁਤਾਬਕ ਬਦਲੋ ਜਾਂ ਹਰ ਕਾਰਡ ਆਪਣੇ ਹੱਥੀਂ ਲਿਖੋ।

ਵਕਫ਼ਿਆਂ ਨਾਲ ਦੁਹਰਾਈ ਕਰੋ
ਸਵਾਲ ਪੜ੍ਹ ਕੇ ਜਵਾਬ ਯਾਦ ਕਰਨ ਦੀ ਕੋਸ਼ਿਸ਼ ਕਰੋ। ਕਾਰਡ ਪਲਟੋ ਤੇ ਦੱਸੋ ਕਿ ਜਵਾਬ ਕਿੰਨੀ ਚੰਗੀ ਤਰ੍ਹਾਂ ਯਾਦ ਸੀ। ਇਸ ਨੂੰ spaced repetition ਕਹਿੰਦੇ ਹਨ। ਔਖੇ ਕਾਰਡ ਛੇਤੀ ਮੁੜ ਆਉਂਦੇ ਹਨ ਤੇ ਸੌਖੇ ਕਾਰਡ ਵੱਡੇ ਵਕਫ਼ੇ ਮਗਰੋਂ।

ਅੰਗਰੇਜ਼ੀ ਸ਼ਬਦਾਂ ਦਾ ਅਭਿਆਸ ਕਰੋ
ਕਿਤਾਬ ਜਾਂ ਗੱਲਬਾਤ ਵਿੱਚ ਮਿਲੇ ਨਵੇਂ ਸ਼ਬਦਾਂ ਦੇ ਫਲੈਸ਼ ਕਾਰਡ ਬਣਾਓ। ਵਰਤੋਂ ਯਾਦ ਰੱਖਣ ਲਈ ਆਪਣਾ ਉਦਾਹਰਨ ਵਾਲਾ ਵਾਕ ਜੋੜੋ। Nibomo ਦੇ ਕੈਟਾਲਾਗ ਵਿੱਚ ਅੰਗਰੇਜ਼ੀ ਦੇ ਫ੍ਰੇਜ਼ਲ ਵਰਬਾਂ ਅਤੇ ਮੁੱਢਲੀ ਸਪੇਨੀ ਸ਼ਬਦਾਵਲੀ ਦੇ ਤਿਆਰ ਡੈੱਕ ਵੀ ਹਨ।

ਸੇਵ ਕੀਤੇ ਕਾਰਡ ਆਫਲਾਈਨ ਦੁਹਰਾਓ
ਸਫ਼ਰ ਦੌਰਾਨ ਜਾਂ ਜਮਾਤਾਂ ਵਿਚਕਾਰ ਕੁਝ ਮਿੰਟ ਮਿਲਣ ਤਾਂ ਸੇਵ ਕੀਤੇ ਕਾਰਡ ਖੋਲ੍ਹੋ। ਮੁੜ ਇੰਟਰਨੈੱਟ ਨਾਲ ਜੁੜਨ ’ਤੇ ਤੁਹਾਡੀ ਤਰੱਕੀ ਸਿੰਕ ਹੋ ਜਾਂਦੀ ਹੈ। ਉਸੇ ਖਾਤੇ ਨਾਲ ਦੂਜੇ ਡਿਵਾਈਸ ’ਤੇ ਵੀ ਪੜ੍ਹਾਈ ਜਾਰੀ ਰੱਖ ਸਕਦੇ ਹੋ।

AI ਸਹੂਲਤਾਂ ਲਈ ਇੰਟਰਨੈੱਟ ਚਾਹੀਦਾ ਹੈ।

### Release notes

- Premium ਦੀ ਮੈਂਬਰਸ਼ਿਪ ਲਓ ਅਤੇ ਆਪਣੀ ਪਸੰਦ ਦੇ ਐਕਸੈਂਟ ਰੰਗ ਚੁਣੋ।
- ਆਪਣੀ OpenAI API ਕੁੰਜੀ ਵਰਤੋ ਅਤੇ AI ਦੀ ਵਰਤੋਂ ਦੇ ਅੰਕੜੇ ਵੇਖੋ।
- ਡੈੱਕ ਮਿਟਾਉਣ ਤੋਂ ਪਹਿਲਾਂ ਪੁਸ਼ਟੀ ਕਰੋ ਅਤੇ ਸੁਧਾਰੀਆਂ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਹੋਰ ਆਸਾਨੀ ਨਾਲ ਜਾਓ।

## Polish - pl-PL

### App Name

Nibomo: Generator fiszek AI

### Short Description

Twórz fiszki z notatek i zdjęć. Ucz się słówek i powtarzaj offline.

### Full Description

Twórz własne fiszki z notatek, zdjęć i tematów, które chcesz opanować. Generator fiszek AI w Nibomo podsuwa pytania i odpowiedzi, a powtórki rozłożone w czasie pomagają utrwalać materiał.

Zrób fiszki z notatek lub zdjęcia
Wklej notatki z zajęć, dodaj zdjęcie strony zeszytu albo wpisz temat. Poproś AI o skupienie się na ważnych pojęciach, definicjach lub przykładach. Popraw pytania i odpowiedzi przed nauką albo napisz fiszki samodzielnie i ułóż z nich własną talię.

Rozłóż powtórki w czasie
Przeczytaj pytanie i odpowiedz z pamięci. Odwróć fiszkę i oceń, jak dobrze udało Ci się przypomnieć odpowiedź. Nibomo wyznaczy kolejną powtórkę. Trudniejsze fiszki wracają wcześniej, a znany materiał możesz powtarzać rzadziej.

Ucz się angielskich i hiszpańskich słówek
Zapisuj słowa z zajęć, książek i rozmów. Dodawaj własne zdania, żeby zapamiętać nie tylko znaczenie, lecz także użycie danego słowa. Możesz też zacząć od gotowej talii z katalogu Nibomo, np. z angielskimi czasownikami frazowymi lub podstawowymi zwrotami po hiszpańsku.

Powtarzaj fiszki offline
Wracaj do zapisanych fiszek w drodze lub między zajęciami. Po ponownym połączeniu z internetem postępy zsynchronizują się między urządzeniami.

Funkcje AI wymagają połączenia z internetem.

### Release notes

- Wykup subskrypcję Premium i dostosuj kolory akcentów.
- Używaj własnego klucza API OpenAI i sprawdzaj wykorzystanie AI.
- Potwierdzaj usuwanie talii i łatwiej poruszaj się po ustawieniach.

## Romanian - ro

### App Name

Nibomo: Flashcards cu AI

### Short Description

Creează flashcarduri din notițe sau poze. Recapitulează și offline.

### Full Description

Creează flashcarduri din notițele de la cursuri, din poze sau pornind de la un subiect. Cu generatorul de flashcarduri din Nibomo poți pregăti seturi de fișe pentru ce ai de învățat.

Transformă materialul de studiu în întrebări
Lipește notițele sau atașează o poză din caiet. Cere-i AI-ului să pregătească întrebări despre definiții, exemple sau idei esențiale. Modifică întrebările și răspunsurile după cum ai nevoie. Poți crea și singur fișe, una câte una.

Folosește repetarea spațiată
Citește întrebarea și încearcă să răspunzi înainte de a întoarce fișa. Apoi indică dacă ți-a fost ușor sau greu să-ți amintești. Nibomo programează următoarea recapitulare și îți arată mai devreme fișele care ți-au dat de furcă.

Creează fișe de vocabular
Adună cuvintele întâlnite la curs, într-o carte sau în conversații. Adaugă propoziții de exemplu sau începe cu un set din catalogul Nibomo, precum verbele frazale în engleză sau vocabularul spaniol pentru începători.

Recapitulează offline
Poți deschide fișele salvate în autobuz sau în pauza dintre cursuri. Recapitulările se sincronizează când te conectezi din nou la internet.

Funcțiile AI necesită o conexiune la internet.

### Release notes

- Abonează-te la Premium și personalizează culorile de accent.
- Folosește propria cheie API OpenAI și consultă datele de utilizare a AI-ului.
- Confirmă ștergerea seturilor și navighează mai ușor prin setări.

## Slovak - sk

### App Name

Nibomo: Učebné kartičky

### Short Description

Kartičky z poznámok a fotiek. Opakujte si učivo v odstupoch aj offline.

### Full Description

Vytvorte si učebné kartičky z vlastných materiálov. Nibomo vám pomocou AI navrhne otázky a odpovede z poznámok, fotky zošita alebo témy. Učivo si potom môžete upevniť rozloženým opakovaním.

Pripravte si vlastné kartičky
Vložte poznámky z prednášky alebo pridajte fotku strany zo zošita. Požiadajte AI, aby sa zamerala na dôležité definície a príklady. Navrhnuté otázky a odpovede upravte podľa seba alebo si kartičky napíšte ručne. Na jednotlivé predmety si môžete vytvoriť vlastné balíčky.

Opakujte v odstupoch
Prečítajte si otázku a skúste si odpoveď vybaviť. Otočte kartičku a ohodnoťte, ako dobre ste si spomenuli. Nibomo podľa vášho hodnotenia určí čas ďalšieho opakovania. Náročnejšie kartičky uvidíte skôr.

Učte sa slovíčka s príkladmi
Pridajte si slovíčka zo školy, z knihy alebo z rozhovoru a napíšte k nim vlastné vety. V katalógu Nibomo nájdete aj hotové balíčky, napríklad anglické frázové slovesá alebo základné španielske slová a frázy.

Majte uložené kartičky poruke aj offline
Opakujte si ich napríklad v autobuse. Po obnovení pripojenia sa pokrok zosynchronizuje medzi zariadeniami.

Funkcie AI vyžadujú pripojenie na internet.

### Release notes

- Predplaťte si Premium a prispôsobte si farby zvýraznenia.
- Používajte vlastný API kľúč OpenAI a sledujte využitie AI.
- Potvrdzujte mazanie balíčkov a jednoduchšie sa orientujte v nastaveniach.

## Slovenian - sl

### App Name

Nibomo: Kartice za učenje

### Short Description

Učne kartice iz zapiskov in fotografij. Ponavljaj v presledkih tudi offline.

### Full Description

V Nibomu si pripravi kartice za učenje iz lastnega gradiva. Umetna inteligenca (AI) predlaga vprašanja in odgovore iz zapiskov, fotografije ali teme. Učne kartice nato ponavljaj v presledkih, da si snov lažje zapomniš.

Ustvari kartice iz zapiskov
Prilepi zapiske s predavanja ali dodaj fotografijo strani iz zvezka. Orodje lahko usmeriš na ključne pojme, razlage ali primere. Vprašanja in odgovore uredi po svoje ali pa kartice napiši samostojno in jih združi v komplete.

Ponavljaj s smiselnimi razmiki
Najprej poskusi odgovor priklicati iz spomina. Obrni kartico in oceni, kako dobro si ga znal. Nibomo na podlagi ocene določi naslednji termin za ponavljanje. Težje kartice se pokažejo prej.

Vadi angleško in špansko besedišče
Iz besed, ki jih srečaš pri pouku, branju ali v pogovoru, sestavi kartice za učenje besedišča. Dodaj svoje primere ali uporabi pripravljen komplet iz kataloga Nibomo, na primer angleške frazne glagole ali osnovne španske besede in izraze.

Ponavljaj tudi brez povezave
Shranjene kartice odpri na poti ali med odmori. Ko si spet na spletu, se napredek sinhronizira med napravami.

Funkcije umetne inteligence potrebujejo internetno povezavo.

### Release notes

- Naroči se na Premium in prilagodi barve poudarkov.
- Uporabi svoj ključ API za OpenAI in spremljaj uporabo AI.
- Potrdi brisanje kompletov in se lažje znajdi v nastavitvah.

## Swedish - sv-SE

### App Name

Nibomo: AI-flashcards

### Short Description

Skapa flashcards av anteckningar och foton. Repetera även offline.

### Full Description

Skapa flashcards med AI utifrån dina anteckningar, foton eller ett ämne. Nibomo hjälper dig att repetera med mellanrum och plugga glosor. Sparade flashkort går att öva på offline.

Skapa flashkort av det du pluggar
Klistra in dina anteckningar, bifoga ett foto av en sida eller beskriv ett ämne. AI föreslår frågor och svar som du kan ändra. Du kan också skriva korten själv.

Repetera med lagom mellanrum
Försök komma på svaret innan du vänder kortet. Bedöm sedan hur bra du mindes det. Med intervallrepetition (spaced repetition) dyker svåra kort upp tidigare, medan kort du kan får vänta längre.

Plugga glosor med egna exempel
Gör kort av ord du stöter på under lektionen, i en bok eller i ett samtal. Lägg gärna till en exempelmening. I Nibomos katalog finns färdiga kortuppsättningar, till exempel engelska partikelverb och spanska glosor för nybörjare.

Repetera sparade kort offline. Dina framsteg synkroniseras när du är uppkopplad igen. AI-funktionerna kräver internetanslutning.

### Release notes

- Prenumerera på Premium och anpassa accentfärgerna.
- Använd din egen OpenAI-API-nyckel och se din AI-användning.
- Bekräfta radering av kortlekar och hitta lättare i inställningarna.

## Swahili - sw

### App Name

Nibomo: Flashcards za AI

### Short Description

Tengeneza kadi kwa AI kutoka kwa noti na picha. Rudia hata bila intaneti.

### Full Description

Tengeneza kadi za kujifunzia (flashcards) kutoka kwa noti, picha au mada unayosoma. Nibomo hukusaidia kupanga marudio kwa vipindi na kusoma bila intaneti ukishahifadhi kadi zako.

Tengeneza kadi kutoka kwa noti au picha
Bandika noti za darasani, ambatisha picha ya ukurasa wa daftari au eleza mada unayotaka kujifunza. Iombe AI itengeneze maswali na majibu kuhusu mambo muhimu unayotaka kukumbuka. Hariri kadi kabla ya kusoma au andika kadi zako mwenyewe.

Rudia kwa vipindi
Soma swali na jaribu kukumbuka jibu kabla ya kugeuza kadi. Kisha chagua jinsi ulivyolikumbuka jibu. Nibomo hupanga marudio yanayofuata kulingana na chaguo lako. Kadi ngumu hurudi mapema, na zile unazozijua vizuri hurudi baada ya muda mrefu zaidi.

Jifunze msamiati wa Kiingereza
Tengeneza kadi za maneno mapya unayokutana nayo darasani, vitabuni au kwenye mazungumzo. Ongeza mifano ya sentensi ili ukumbuke jinsi ya kutumia kila neno. Unaweza pia kuanza na seti iliyo tayari kutoka kwenye katalogi ya Nibomo, kama vile kadi za vitenzi vya Kiingereza vyenye maneno zaidi ya moja au za msamiati wa Kihispania kwa wanaoanza.

Soma kadi zilizohifadhiwa bila intaneti
Fungua kadi zako ukiwa safarini au wakati huna intaneti. Ukiingia kwenye akaunti yako, maendeleo yako yatasawazishwa kwenye vifaa vyako utakapounganishwa tena na intaneti.

Vipengele vya AI vinahitaji intaneti.

### Release notes

- Jisajili kwa Premium na ubadilishe rangi za msisitizo.
- Tumia ufunguo wako wa API ya OpenAI na uone matumizi ya AI.
- Thibitisha kufuta makundi ya kadi na upitie mipangilio iliyoboreshwa kwa urahisi zaidi.

## Tamil (India) - ta-IN

### App Name

Nibomo: Make AI Flashcards

### Short Description

AI மூலம் குறிப்புகளையும் படங்களையும் அட்டைகளாக்குங்கள். ஆஃப்லைனில் படியுங்கள்.

### Full Description

வகுப்புக் குறிப்புகள், நோட்டுப் பக்கத்தின் புகைப்படம் அல்லது நீங்கள் படிக்க விரும்பும் தலைப்பிலிருந்து Nibomo மூலம் ஃபிளாஷ் கார்டுகளை உருவாக்குங்கள். இடைவெளி விட்டு மீண்டும் படியுங்கள். அட்டைகளைச் சேமித்த பின் இணையமின்றியும் பயிற்சி செய்யலாம்.

குறிப்புகளிலிருந்து ஃபிளாஷ் கார்டுகள்
நினைவில் வைக்க வேண்டிய வரையறைகள், எடுத்துக்காட்டுகள் அல்லது முக்கியத் தகவல்களைக் கொண்டு கேள்விகளையும் பதில்களையும் தயாரிக்க AIயிடம் கேளுங்கள். அவற்றை உங்களுக்குப் புரியும் வகையில் திருத்துங்கள். அட்டைகளை ஒவ்வொன்றாக நீங்களே எழுதவும் முடியும்.

இடைவெளி மீள்பயிற்சி (spaced repetition)
கேள்வியைப் படித்ததும் பதிலை நினைவுகூர முயலுங்கள். அட்டையைத் திருப்பிய பின் பதில் எந்த அளவுக்கு நினைவில் இருந்தது என்பதைப் பதிவு செய்யுங்கள். அதற்கேற்ப அடுத்த பயிற்சியை Nibomo திட்டமிடும். கடினமான அட்டைகள் சீக்கிரமாகவும் நன்கு நினைவில் உள்ள அட்டைகள் நீண்ட இடைவெளிக்குப் பிறகும் மீண்டும் வரும்.

ஆங்கில வார்த்தைகளைக் கற்றுக்கொள்ளுங்கள்
வகுப்பில், புத்தகத்தில் அல்லது உரையாடலில் கேட்கும் புதிய சொற்களுக்கு அட்டைகளை உருவாக்குங்கள். ஒரு சொல்லை எப்படிப் பயன்படுத்துவது என்பதை நினைவில் வைக்க உங்கள் சொந்த எடுத்துக்காட்டு வாக்கியங்களைச் சேருங்கள். Nibomo தொகுப்பில் ஆங்கிலச் சொற்றொடர் வினைச்சொற்களுக்கும் தொடக்கநிலை ஸ்பானியச் சொற்களுக்கும் தயாராக உள்ள அட்டைகள் கிடைக்கின்றன.

சேமித்த அட்டைகளை இணையமின்றிப் படியுங்கள்
பயணத்திலோ வகுப்புகளுக்கு இடையிலோ சில நிமிடங்கள் கிடைக்கும்போது பயிற்சி செய்யுங்கள். மீண்டும் இணையத்தில் இணைந்ததும் பயிற்சி முன்னேற்றம் ஒத்திசையும்.

AI அம்சங்களுக்கு இணைய இணைப்பு தேவை.

### Release notes

- Premium சந்தாவைப் பெற்று, விருப்பமான சிறப்பம்ச நிறங்களைத் தேர்வுசெய்யுங்கள்.
- உங்கள் சொந்த OpenAI API விசையைப் பயன்படுத்தி, AI பயன்பாட்டைப் பாருங்கள்.
- அட்டைத் தொகுப்புகளை நீக்கும் முன் உறுதிப்படுத்துங்கள்; மேம்படுத்தப்பட்ட அமைப்புகளை எளிதாகப் பயன்படுத்துங்கள்.

## Telugu (India) - te-IN

### App Name

Nibomo: Make AI Flashcards

### Short Description

AIతో నోట్స్, ఫోటోలను కార్డులుగా మార్చండి. ఆఫ్‌లైన్‌లో పునశ్చరణ చేయండి.

### Full Description

తరగతి నోట్స్, నోట్‌బుక్ పేజీ ఫోటో లేదా మీరు చదవాలనుకున్న అంశం నుంచి Nibomoతో ఫ్లాష్‌కార్డ్‌లు తయారు చేసుకోండి. విరామాలతో మళ్లీ చదవండి. కార్డులు సేవ్ చేసిన తర్వాత ఇంటర్నెట్ లేకున్నా వాటిని తెరవచ్చు.

గమనికల నుంచి ఫ్లాష్‌కార్డ్‌లు
గుర్తుంచుకోవాల్సిన నిర్వచనాలు, ఉదాహరణలు లేదా ముఖ్య విషయాలపై దృష్టి పెట్టి ప్రశ్నలు, సమాధానాలు తయారు చేయమని AIని అడగండి. అవి మీకు అర్థమయ్యేలా సవరించుకోండి. ఒక్కో కార్డును మీరే రాయవచ్చు.

విరామాలతో పునశ్చరణ (spaced repetition)
ప్రశ్న చదివి సమాధానం గుర్తు తెచ్చుకోవడానికి ప్రయత్నించండి. కార్డును తిప్పిన తర్వాత సమాధానం ఎంత బాగా గుర్తొచ్చిందో నమోదు చేయండి. దాన్ని బట్టి Nibomo తదుపరి పునశ్చరణను నిర్ణయిస్తుంది. కష్టమైన కార్డులు త్వరగా మళ్లీ వస్తాయి. బాగా గుర్తున్న కార్డులు ఎక్కువ విరామం తర్వాత వస్తాయి.

ఆంగ్ల పదాలు నేర్చుకోండి
తరగతిలో, పుస్తకంలో లేదా సంభాషణలో ఎదురైన కొత్త పదాలతో ఫ్లాష్‌కార్డ్‌లు తయారు చేసుకోండి. పదం ఎలా వాడాలో గుర్తుంచుకోవడానికి మీ సొంత ఉదాహరణ వాక్యాలు జోడించండి. ఆంగ్ల ఫ్రేజల్ వెర్బ్స్, ప్రారంభ స్థాయి స్పానిష్ పదాలకు Nibomo కేటలాగ్‌లో సిద్ధంగా ఉన్న కార్డులనూ ఉపయోగించవచ్చు.

సేవ్ చేసిన కార్డులను ఆఫ్‌లైన్‌లో చదవండి
ప్రయాణంలోనో తరగతుల మధ్యలోనో కొన్ని నిమిషాలు దొరికినప్పుడు సాధన చేయండి. మళ్లీ ఇంటర్నెట్‌కు కనెక్ట్ అయినప్పుడు మీ ప్రగతి సింక్ అవుతుంది.

AI ఫీచర్లకు ఇంటర్నెట్ అవసరం.

### Release notes

- Premiumకు సభ్యత్వం తీసుకుని, మీకు నచ్చిన యాక్సెంట్ రంగులను ఎంచుకోండి.
- మీ సొంత OpenAI API కీని ఉపయోగించి, AI వినియోగాన్ని చూడండి.
- డెక్‌లను తొలగించే ముందు నిర్ధారించండి, మెరుగైన సెట్టింగ్‌లను మరింత సులభంగా ఉపయోగించండి.

## Thai - th

### App Name

Nibomo: สร้างแฟลชการ์ดด้วย AI

### Short Description

เปลี่ยนโน้ตและรูปเป็นแฟลชการ์ด ทบทวนแบบเว้นระยะ ออฟไลน์ได้เมื่อบันทึกการ์ดแล้ว

### Full Description

เปลี่ยนโน้ตจากชั้นเรียน รูปถ่าย และหัวข้อที่อยากเรียนให้เป็นแฟลชการ์ดด้วย Nibomo สร้างชุดการ์ดของตัวเอง ทบทวนแบบเว้นระยะ และเปิดการ์ดที่บันทึกไว้ได้แม้ไม่มีอินเทอร์เน็ต

สร้างแฟลชการ์ดจากโน้ตและรูป
วางโน้ตจากชั้นเรียน แนบรูปหน้าสมุด หรือพิมพ์หัวข้อที่อยากเรียน ให้ AI ช่วยร่างคำถามและคำตอบจากนิยาม ตัวอย่าง หรือใจความสำคัญที่คุณอยากจำ จากนั้นแก้ไขให้เข้าใจก่อนเริ่มทบทวน หรือสร้างการ์ดเองทีละใบก็ได้

ทบทวนแบบเว้นระยะ
อ่านคำถามแล้วลองนึกคำตอบก่อนพลิกการ์ด จากนั้นประเมินว่าจำได้ดีแค่ไหน Nibomo ใช้ผลประเมินเพื่อกำหนดเวลาทบทวนครั้งถัดไป การ์ดที่ยากจะกลับมาเร็วขึ้น ส่วนการ์ดที่จำได้แม่นจะเว้นช่วงนานกว่า

ฝึกคำศัพท์ภาษาอังกฤษและภาษาสเปน
สร้างบัตรคำศัพท์จากคำที่พบในชั้นเรียน ในหนังสือ หรือในบทสนทนา เพิ่มประโยคตัวอย่างของตัวเองเพื่อจำวิธีใช้ หรือเริ่มด้วยชุดการ์ดจากคลัง Nibomo เช่น กริยาวลีภาษาอังกฤษหรือคำศัพท์ภาษาสเปนสำหรับผู้เริ่มต้น

เปิดแฟลชการ์ดออฟไลน์
ระหว่างเดินทางหรือพักจากชั้นเรียน เปิดการ์ดที่บันทึกไว้แล้วทบทวนสักสองสามใบ เมื่อกลับมาออนไลน์ก็ซิงค์ความคืบหน้าและเรียนต่อบนอุปกรณ์อื่นได้

ฟีเจอร์ AI ต้องเชื่อมต่ออินเทอร์เน็ต

### Release notes

- สมัคร Premium และปรับแต่งสีเน้นได้ตามใจ
- ใช้คีย์ OpenAI API ของคุณเองและดูการใช้งาน AI
- ยืนยันก่อนลบชุดการ์ด และใช้งานการตั้งค่าที่ปรับปรุงใหม่ได้สะดวกขึ้น

## Turkish - tr-TR

### App Name

Nibomo: Bilgi Kartları

### Short Description

Notlarından ve fotoğraflarından bilgi kartları oluştur. Çevrimdışı tekrar et.

### Full Description

Nibomo ile ders notlarını ve fotoğraflarını bilgi kartlarına dönüştür. Kendi destelerini oluştur, aralıklı tekrar yap ve kayıtlı kartlarınla çevrimdışı çalış.

Notlardan ve fotoğraflardan bilgi kartı oluştur
Ders notlarını yapıştır, defter sayfanın fotoğrafını ekle ya da öğrenmek istediğin konuyu yaz. Yapay zekâdan tanımlara, örneklere veya önemli noktalara odaklanan soru ve cevaplar önermesini iste. Çalışmadan önce önerileri düzenle veya kartlarını tek tek kendin yaz.

Aralıklı tekrarla hatırla
Soruyu oku ve kartı çevirmeden cevabı hatırlamaya çalış. Sonra ne kadar iyi hatırladığını işaretle. Nibomo bir sonraki tekrarı bu değerlendirmeye göre planlar. Zorlandığın kartlar daha erken karşına çıkar, iyi bildiklerin ise daha uzun süre bekler.

İngilizce ve İspanyolca kelime kartları
Derste, okurken veya konuşurken karşılaştığın kelimeler için kart hazırla. Kelimenin nasıl kullanıldığını hatırlamak için örnek bir cümle ekle. Nibomo kataloğunda İngilizce öbek fiiller ve başlangıç düzeyi İspanyolca kelimeler gibi hazır desteler de bulabilirsin.

Çevrimdışı tekrar
Yolda veya ders arasında kayıtlı kartlarını internetsiz açıp tekrar et. Yeniden internete bağlandığında aynı hesapla oturum açarak ilerlemeni eşitle ve başka bir cihazda kaldığın yerden devam et.

Yapay zekâ özellikleri internet bağlantısı gerektirir.

### Release notes

- Premium’a abone olun ve vurgu renklerini özelleştirin.
- Kendi OpenAI API anahtarınızı kullanın ve yapay zekâ kullanımınızı görüntüleyin.
- Deste silme işlemini onaylayın ve ayarlarda daha kolay gezinin.

## Ukrainian - uk

### App Name

Nibomo: Флешкартки з конспекту

### Short Description

Створюйте картки з конспектів і фото. Повторюйте збережені картки офлайн.

### Full Description

Створюйте флешкартки з власних матеріалів у Nibomo. Перетворюйте нотатки, фото або тему на запитання й відповіді, складайте власні колоди та закріплюйте вивчене за допомогою інтервального повторення.

Створюйте картки з конспектів
Вставте нотатки з лекції чи додайте фото сторінки зошита. Попросіть ШІ зосередитися на потрібних визначеннях, фактах або прикладах. Перевірте й відредагуйте запропоновані запитання та відповіді. Картки також можна створити вручну й розподілити за темами.

Повторюйте матеріал у потрібний час
Прочитайте запитання й спробуйте відповісти з пам’яті. Перегорніть картку й оцініть, наскільки добре пригадали відповідь. За цією оцінкою Nibomo запланує наступне повторення. Складні картки повертаються раніше, а знайомі — пізніше.

Вивчайте англійські й іспанські слова
Створюйте картки для вивчення слів, які чуєте на заняттях або зустрічаєте в книжках. Додавайте власні речення, щоб пам’ятати, як вживаються слова. Можна почати й з готових колод із каталогу Nibomo, зокрема з англійських фразових дієслів або базової іспанської лексики.

Повторюйте флешкартки офлайн
Відкривайте збережені картки в дорозі або на перерві. Щоб синхронізувати прогрес між пристроями, підключіться до інтернету й увійдіть в один і той самий обліковий запис.

Для функцій ШІ потрібне підключення до інтернету.

### Release notes

- Оформлюйте підписку Premium і налаштовуйте акцентні кольори.
- Використовуйте власний API-ключ OpenAI та переглядайте статистику використання ШІ.
- Підтверджуйте видалення колод і користуйтеся зручнішими налаштуваннями.

## Urdu - ur

### App Name

Nibomo: AI فلیش کارڈز

### Short Description

نوٹس اور تصاویر سے فلیش کارڈز بنائیں۔ محفوظ کارڈز آف لائن دہرائیں۔

### Full Description

کلاس کے نوٹس، نوٹ بک کی تصویر یا کسی موضوع سے Nibomo میں فلیش کارڈز (flashcards) بنائیں۔ اپنے ڈیک ترتیب دیں اور کارڈز محفوظ کرنے کے بعد انٹرنیٹ کے بغیر بھی دہرائی کریں۔

نوٹس سے فلیش کارڈز بنائیں
نوٹس پیسٹ کریں یا تصویر لگائیں۔ AI کو بتائیں کہ کون سی تعریفیں، مثالیں یا اہم نکات یاد رکھنے ہیں۔ تیار سوالوں اور جوابوں کو اپنی ضرورت کے مطابق بدلیں۔ چاہیں تو ہر کارڈ خود لکھیں۔

وقفے وقفے سے تکرار کریں
سوال پڑھ کر جواب یاد کرنے کی کوشش کریں۔ کارڈ پلٹ کر بتائیں کہ جواب کتنی اچھی طرح یاد تھا۔ اس طریقے کو اسپیسڈ ریپیٹیشن کہتے ہیں۔ مشکل کارڈز جلد اور آسان کارڈز زیادہ وقفے کے بعد دوبارہ دکھائی دیتے ہیں۔

انگریزی الفاظ یاد کریں
پڑھتے وقت یا گفتگو میں ملنے والے نئے الفاظ کے فلیش کارڈز بنائیں۔ استعمال یاد رکھنے کے لیے اپنے جملے بطور مثال شامل کریں۔ Nibomo کے کیٹلاگ میں انگریزی فریزل وربز اور ابتدائی ہسپانوی الفاظ کے تیار ڈیک بھی ہیں۔

محفوظ فلیش کارڈز آف لائن دہرائیں
سفر کے دوران یا کلاسوں کے درمیان چند منٹ ملیں تو محفوظ کارڈز کھولیں۔ دوبارہ انٹرنیٹ سے جڑنے پر دہرائی کی پیش رفت سنک ہوتی ہے۔ اسی اکاؤنٹ سے دوسرے ڈیوائس پر پڑھائی جاری رکھ سکتے ہیں۔

AI خصوصیات کے لیے انٹرنیٹ ضروری ہے۔

### Release notes

- Premium کی رکنیت لیں اور اپنی پسند کے ایکسنٹ رنگ منتخب کریں۔
- اپنی OpenAI API کلید استعمال کریں اور AI کے استعمال کی تفصیلات دیکھیں۔
- ڈیک حذف کرنے سے پہلے تصدیق کریں اور بہتر سیٹنگز میں زیادہ آسانی سے جائیں۔

## Vietnamese - vi

### App Name

Nibomo: Tạo thẻ ghi nhớ với AI

### Short Description

Tạo thẻ từ ghi chú và ảnh. Ôn ngoại tuyến theo phương pháp lặp lại ngắt quãng.

### Full Description

Dùng Nibomo để biến ghi chú, ảnh và chủ đề đang học thành thẻ ghi nhớ. Tự tạo bộ thẻ, ôn theo phương pháp lặp lại ngắt quãng và tiếp tục học khi mất mạng với thẻ đã lưu.

Tạo flashcard từ ghi chú và ảnh
Dán ghi chú trên lớp, đính kèm ảnh một trang vở hoặc mô tả chủ đề bạn muốn học. Nhờ AI tập trung vào định nghĩa, ví dụ hay ý chính cần nhớ. Bạn có thể chỉnh sửa câu hỏi và câu trả lời trước khi ôn, hoặc tự viết từng thẻ.

Ôn tập ngắt quãng để nhớ lâu hơn
Đọc câu hỏi, thử nhớ câu trả lời rồi mới lật thẻ. Sau khi xem đáp án, đánh giá xem bạn nhớ được đến đâu. Nibomo dựa vào đánh giá đó để lên lịch ôn lại. Thẻ khó sẽ quay lại sớm hơn, còn thẻ đã quen sẽ được ôn sau.

Học từ vựng tiếng Anh và tiếng Tây Ban Nha
Ghi lại từ mới bạn gặp trên lớp, trong sách hoặc khi trò chuyện bằng cách tạo thẻ. Thêm câu ví dụ của riêng bạn để nhớ cách dùng từ. Bạn cũng có thể chọn một bộ thẻ có sẵn trong danh mục Nibomo, như cụm động từ tiếng Anh hoặc từ vựng tiếng Tây Ban Nha cho người mới.

Ôn thẻ đã lưu khi ngoại tuyến
Tranh thủ ôn vài thẻ lúc đi xe hoặc nghỉ giữa giờ. Khi có mạng trở lại, bạn có thể đồng bộ tiến độ để học tiếp trên thiết bị khác.

Tính năng AI cần có kết nối internet.

### Release notes

- Đăng ký Premium và tùy chỉnh màu nhấn.
- Dùng khóa API OpenAI của riêng bạn và xem mức sử dụng AI.
- Xác nhận trước khi xóa bộ thẻ và điều hướng dễ dàng hơn trong phần cài đặt.

## Zulu - zu

### App Name

Nibomo: Flashcards nge-AI

### Short Description

Guqula amanothi nezithombe kube amakhadi. Funda ngaphandle kwe-inthanethi.

### Full Description

Yenza amakhadi okufunda (flashcards) ngamanothi, ngezithombe noma ngesihloko osifundayo. Buyekeza ngezikhawu ukuze ukhumbule okufundile, futhi uvule amakhadi agciniwe noma ungaxhunyiwe ku-inthanethi.

Yenza amakhadi okufunda ngamanothi nezithombe
Faka amanothi aseklasini, namathisela isithombe sekhasi lencwadi yamanothi noma uchaze isihloko ofuna ukusifunda. Cela i-AI ibhale imibuzo nezimpendulo ngamaphuzu abalulekile. Hlela imibuzo nezimpendulo ngaphambi kokufunda, noma uzibhalele amakhadi akho.

Buyekeza ngezikhawu
Zama ukukhumbula impendulo ngaphambi kokubheka uhlangothi olungemuva lwekhadi. Bese ukhetha ukuthi uyikhumbule kahle kangakanani. I-Nibomo ihlela isikhathi sokubuyekeza ngokwendlela okhumbule ngayo. Amakhadi anzima abuya ngokushesha, kanti lawo osuwazi kahle abuya ngemva kwesikhathi eside.

Funda amagama esiNgisi ngamakhadi
Yenza amakhadi ngamagama ohlangana nawo ezincwadini, ekilasini noma ezingxoxweni. Faka izibonelo zemisho ukuze ukhumbule indlela yokusebenzisa igama ngalinye. Ungaqala nangeqoqo lamakhadi elisohlwini lwe-Nibomo, njengeqoqo lemishwana yesiNgisi noma iqoqo lamagama esiSpanishi labaqalayo.

Funda ngaphandle kwe-inthanethi
Buyekeza amakhadi osuwagcinile uma usohambeni noma ungaxhunyiwe ku-inthanethi. Uma ungene ngemvume, intuthuko yakho iyavumelaniswa phakathi kwamadivayisi lapho usuxhumeke futhi.

Izici ze-AI zidinga i-inthanethi.

### Release notes

- Bhalisela i-Premium futhi wenze imibala yokugqamisa ibe ngeyakho.
- Sebenzisa ukhiye wakho we-API ye-OpenAI futhi ubuke ukusetshenziswa kwe-AI.
- Qinisekisa ukususa amaqoqo amakhadi futhi uzulazule kalula ezilungiselelweni ezithuthukisiwe.

## Chinese (Traditional) - zh-TW

### App Name

Nibomo：AI 閃卡製作

### Short Description

把筆記和照片做成閃卡。用間隔複習背單字，儲存後也能離線複習。

### Full Description

把上課筆記、照片和想學的主題做成閃卡。用 Nibomo 建立自己的卡組，依照記憶狀況安排間隔複習，也能離線複習已儲存的卡片。

從筆記或照片製作閃卡
貼上課堂筆記、附上一張筆記照片，或描述想學的主題。讓 AI 把定義、例子或重要觀念整理成問答。確認並編輯內容後再開始複習，也可以自己一張一張寫卡片。

用間隔重複記得更久
先看問題、試著想出答案，再翻卡評估自己記得多少。Nibomo 依照你的評估安排下次複習，難記的內容比較快再出現，熟悉的內容可以隔久一點再看。

自製單字卡，練習英文和西班牙文
把上課、閱讀或聊天時遇到的生字做成卡片，加上例句來記住用法。也能從 Nibomo 的卡組目錄選一套卡片開始，例如英文片語動詞或西班牙文入門詞彙。

離線複習
在捷運上或下課空檔，打開已儲存的閃卡複習幾張。重新連線後可同步進度，再到另一台裝置上繼續。

AI 功能需要網路連線。

## Chinese (Hong Kong) - zh-HK

### App Name

Nibomo：AI Flashcards

### Short Description

用 AI 將筆記和相片製成閃卡。以間隔重複溫習生字，儲存後可離線使用。

### Full Description

將課堂筆記、相片和想學的主題製成閃卡。用 Nibomo 建立自己的卡組，以間隔重複溫習，沒有網絡時也可翻看已儲存的卡片。

用筆記或相片製作閃卡
貼上筆記、附上筆記簿的相片，或說明想溫習的主題。請 AI 根據定義、例子或重點擬出問題和答案。修改內容後便可開始溫習，你也可以逐張自製卡片。

按記憶程度安排溫習
先試想答案，再翻卡並評估自己記得多少。Nibomo 會按你的評估安排下一次溫習，未記熟的卡片會較快再次出現，熟悉的內容則可隔久一點再看。

自製英文生字卡
將上堂、閱讀或傾談時遇到的生字做成卡片，加上例句來記住用法。你也可從 Nibomo 的卡組目錄選一套卡片開始，例如英文片語動詞或西班牙語入門詞彙。

離線溫習
搭港鐵或小休時，打開已儲存的閃卡溫習幾張。重新連接網絡後可同步進度，在另一部裝置上繼續學習。

AI 功能需要連接互聯網。

## English (Australia) - en-AU

### App Name

Nibomo: AI Flashcard Maker

### Short Description

Make flashcards from notes or photos. Review offline with spaced repetition.

### Full Description

Turn class notes and photos into flashcards with Nibomo’s AI flashcard maker. Build your own decks, use spaced repetition to revise and review saved flashcards offline.

Make flashcards from your notes
Paste notes from class, add a photo of a notebook page or give AI a topic. Ask it to focus on the definitions or examples you need to remember. Edit the draft questions and answers before you study, or write your own cards from scratch.

Make time for the cards you find harder
Read the question, try to recall the answer, then flip the card and rate how well you remembered it. Spaced repetition brings difficult cards back sooner and gives familiar cards a longer gap. Use it to revise for an exam or keep key concepts fresh after the course ends.

Practise vocabulary with examples
Make flashcards for words you meet in a book, in class or in conversation. Add a sentence to help you remember how each word is used. Start with your own deck, or choose a catalogue deck for beginner Spanish vocabulary or English phrasal verbs.

Keep revising offline
Open your saved cards on the train or between classes. When you’re back online, sign in to sync your reviews across devices.

AI features need an internet connection.

## English (Canada) - en-CA

### App Name

Nibomo: AI Flashcard Maker

### Short Description

Turn notes and photos into flashcards. Study French vocabulary offline.

### Full Description

Make flashcards from your notes, photos or a topic. Nibomo’s AI flashcard maker helps you build a study deck you can edit, then spaced repetition helps you keep up with reviews.

Turn your class notes into flashcards
Paste a passage from your notes, add a photo of a page, or describe a topic you want to study. Ask AI to draft questions and answers about the facts, definitions or examples you care about. Edit the draft before studying, or write your own questions and answers one card at a time.

Build French and English vocabulary
Make French flashcards from words you encounter in class, at work or in conversation. Add a sample sentence on the back to remember how a word is used. Use the same approach for English vocabulary, or try a ready-made deck from the Nibomo catalogue.

Review at intervals that fit what you remember
Read a question and try to answer from memory. Flip the card and rate your recall. Nibomo uses spaced repetition to bring back difficult cards sooner and leave more time between reviews of familiar cards.

Review saved flashcards offline
Open saved cards on the bus or between classes. When you’re back online, sign in to sync your review progress across devices.

AI features need an internet connection.

## English (United Kingdom) - en-GB

### App Name

Nibomo: AI Revision Cards

### Short Description

Make flashcards from notes and photos. Revise offline with spaced repetition.

### Full Description

Make your own revision cards from lesson notes, photos or a topic. Nibomo’s AI flashcard maker drafts questions and answers you can edit. Review your deck with spaced repetition and keep revising offline once the cards are saved.

Turn study notes into flashcards
Paste notes from class, attach a photo of a page or tell AI what you want to revise. Ask it to focus on the key facts, definitions or worked examples. Edit the questions and answers to match what you need to learn, or write your revision cards from scratch.

Revise at the right intervals
Try to answer each question before you flip the card. Rate how well you remembered it and Nibomo will schedule the next review. Spaced repetition gives familiar cards a longer gap and brings difficult ones back sooner. Use it to prepare for an exam or keep material fresh afterwards.

Make vocabulary flashcards
Create a deck for Spanish, French or English words you want to remember. Add an example sentence to practise using the word in context. You can also choose a ready-made deck from the Nibomo catalogue, such as beginner Spanish vocabulary.

Take your revision offline
Open saved flashcards on the bus or whenever you have a few minutes. When you’re back online, sign in to sync your review progress across devices.

AI features need an internet connection.

## French (Canada) - fr-CA

### App Name

Nibomo : Cartes-éclair IA

### Short Description

Créez des cartes-éclair à partir de notes ou de photos. Révisez hors ligne.

### Full Description

Créez des cartes-éclair à partir de vos notes de cours, d’une photo ou d’un sujet. Avec Nibomo, préparez du matériel d’étude à votre façon et retenez-le grâce à la répétition espacée.

Passez des notes aux cartes-éclair
Collez vos notes ou joignez une photo de votre cahier. Demandez à l’IA de préparer des questions sur les définitions ou les idées principales. Relisez les réponses et modifiez-les au besoin. Vous pouvez aussi écrire vos cartes une à une.

Faites revenir les notions au bon moment
Tentez de répondre de mémoire, puis retournez la carte. Indiquez ensuite si vous vous souveniez de la réponse. Nibomo utilise votre évaluation pour décider quand vous présenter de nouveau la carte et fait revenir plus tôt celles qui vous posent problème.

Exercez-vous avec des cartes de vocabulaire
Ajoutez les mots qui vous sont utiles à l’école, au travail ou dans une conversation. Écrivez une phrase d’exemple pour les revoir en contexte, ou choisissez un ensemble du catalogue, comme des verbes à particule en anglais ou du vocabulaire espagnol pour débuter.

Étudiez hors ligne
Ouvrez vos cartes déjà enregistrées dans l’autobus ou entre deux cours. Vos révisions se synchronisent dès que vous retrouvez une connexion.

Les fonctions d’IA nécessitent une connexion Internet.

## Portuguese (Portugal) - pt-PT

### App Name

Nibomo: Cartões de estudo

### Short Description

Crie cartões com IA a partir de apontamentos ou fotografias. Reveja offline.

### Full Description

Crie cartões de estudo a partir de apontamentos, fotografias ou temas que pretende estudar. O Nibomo ajuda a preparar os seus flashcards e a planear a revisão com repetição espaçada.

Dos apontamentos aos cartões
Cole os apontamentos ou anexe uma fotografia de uma página do caderno. Peça à IA que prepare perguntas sobre os conceitos, as definições ou os exemplos que quer memorizar. Pode editar as perguntas e respostas ou escrever os seus cartões de raiz.

Faça revisões espaçadas
Tente responder de memória antes de virar o cartão. Depois indique até que ponto se lembrava da resposta. O Nibomo agenda a revisão seguinte e mostra-lhe mais cedo os cartões que lhe deram mais trabalho.

Crie cartões de vocabulário
Recolha as palavras que encontra nas aulas, numa leitura ou numa conversa. Acrescente exemplos ou comece com um baralho do catálogo do Nibomo, como o de verbos frásicos em inglês ou o de vocabulário básico de espanhol.

Reveja os seus flashcards offline
Abra os cartões guardados, por exemplo nos transportes ou no intervalo entre aulas. As revisões são sincronizadas quando volta a ter ligação à Internet.

As funcionalidades de IA precisam de ligação à Internet.

## Malay - ms

### App Name

Nibomo: Kad Imbas dengan AI

### Short Description

Buat kad imbas daripada nota dan gambar. Ulang kaji kad di luar talian.

### Full Description

Buat kad imbas daripada nota, gambar atau topik yang ingin anda pelajari. Dengan Nibomo, anda boleh membina set kad sendiri, mengulang kaji dengan pengulangan berjarak, dan terus belajar di luar talian selepas kad disimpan.

Tukar bahan belajar kepada kad imbas
Tampal nota kelas, lampirkan gambar halaman buku nota atau nyatakan topik yang ingin anda pelajari. Minta AI merangka soalan dan jawapan berdasarkan takrif, contoh atau fakta penting. Sunting draf sebelum belajar atau tulis kad anda sendiri.

Ingat pelajaran dengan pengulangan berjarak
Baca soalan dan cuba ingat jawapannya. Balikkan kad, kemudian nilai sejauh mana anda mengingati jawapan itu. Nibomo menjadualkan sesi seterusnya berdasarkan penilaian anda. Kad yang sukar muncul semula lebih awal. Kad yang sudah anda kuasai muncul selepas sela yang lebih panjang.

Latih kosa kata dengan kad imbas
Buat kad untuk perkataan yang anda temui di kelas, dalam buku atau semasa berbual. Tambah contoh ayat sendiri untuk mengingat cara perkataan itu digunakan. Cuba set kad sedia ada daripada katalog Nibomo, seperti kata kerja frasa bahasa Inggeris atau kosa kata bahasa Sepanyol untuk pemula.

Ulang kaji kad imbas di luar talian
Buka kad yang telah disimpan semasa dalam perjalanan atau apabila tiada internet. Log masuk ke akaun anda untuk menyegerakkan kemajuan antara peranti apabila kembali dalam talian.

Ciri AI memerlukan sambungan internet.

## Malay (Malaysia) - ms-MY

### App Name

Nibomo: Kad Imbas dengan AI

### Short Description

Buat kad imbas daripada nota dan gambar. Ulang kaji kad di luar talian.

### Full Description

Buat kad imbas daripada nota, gambar atau topik yang ingin anda pelajari. Dengan Nibomo, anda boleh membina set kad sendiri, mengulang kaji dengan pengulangan berjarak, dan terus belajar di luar talian selepas kad disimpan.

Tukar bahan belajar kepada kad imbas
Tampal nota kelas, lampirkan gambar halaman buku nota atau nyatakan topik yang ingin anda pelajari. Minta AI merangka soalan dan jawapan berdasarkan takrif, contoh atau fakta penting. Sunting draf sebelum belajar atau tulis kad anda sendiri.

Ingat pelajaran dengan pengulangan berjarak
Baca soalan dan cuba ingat jawapannya. Balikkan kad, kemudian nilai sejauh mana anda mengingati jawapan itu. Nibomo menjadualkan sesi seterusnya berdasarkan penilaian anda. Kad yang sukar muncul semula lebih awal. Kad yang sudah anda kuasai muncul selepas sela yang lebih panjang.

Latih kosa kata dengan kad imbas
Buat kad untuk perkataan yang anda temui di kelas, dalam buku atau semasa berbual. Tambah contoh ayat sendiri untuk mengingat cara perkataan itu digunakan. Cuba set kad sedia ada daripada katalog Nibomo, seperti kata kerja frasa bahasa Inggeris atau kosa kata bahasa Sepanyol untuk pemula.

Ulang kaji kad imbas di luar talian
Buka kad yang telah disimpan semasa dalam perjalanan atau apabila tiada internet. Log masuk ke akaun anda untuk menyegerakkan kemajuan antara peranti apabila kembali dalam talian.

Ciri AI memerlukan sambungan internet.

## Afrikaans - af

### App Name

Nibomo: Flitskaarte met KI

### Short Description

Maak flitskaarte uit notas en foto's. Hersien gestoorde kaarte vanlyn.

### Full Description

Verander jou klasnotas, foto's of onderwerpe in flitskaarte met Nibomo. Maak jou eie stelle en hersien dit met gespasieerde herhaling. Sodra jou kaarte gestoor is, kan jy ook sonder internet oefen.

Maak flitskaarte uit jou studiemateriaal
Plak jou notas, voeg 'n foto van 'n bladsy by of beskryf wat jy wil leer. Vra die KI om vrae en antwoorde oor belangrike feite, definisies of voorbeelde op te stel. Pas dit aan voordat jy begin leer, of skryf elke kaart self.

Hersien met tussenposes
Lees die vraag en probeer die antwoord onthou voordat jy die kaart omdraai. Dui aan hoe goed jy die antwoord onthou het. Nibomo beplan die volgende hersiening volgens jou beoordeling. Moeilike kaarte kom gouer terug en bekende kaarte ná 'n langer tyd.

Brei jou woordeskat uit
Maak flitskaarte vir nuwe woorde uit 'n boek, 'n les of 'n gesprek. Skryf jou eie voorbeeldsinne om die woorde in konteks te leer. Jy kan ook met 'n klaargemaakte stel uit die Nibomo-katalogus begin, soos Engelse frasewerkwoorde of Spaanse woordeskat vir beginners.

Hersien jou gestoorde flitskaarte vanlyn. Meld met dieselfde rekening aan en sinkroniseer jou vordering wanneer jy weer aanlyn is. Die KI-funksies het internet nodig.

## Albanian - sq

### App Name

Nibomo: AI Flashcards

### Short Description

Kartela flash nga shënime e foto. Përsëritni kartelat e ruajtura pa internet.

### Full Description

Krijoni kartela flash me Nibomo nga shënimet e mësimit, një foto ose një temë që doni të studioni. Organizojini në grupe dhe përsëritini në intervale për të mbajtur mend materialin.

Nga shënimet te kartelat
Kopjoni shënimet dhe ngjitini në aplikacion, shtoni një foto të faqes së fletores ose përshkruani temën. Kërkojini inteligjencës artificiale (IA) të hartojë pyetje e përgjigje për përkufizimet, shembujt ose idetë që doni të mbani mend. Përpunoni kartelat para se të studioni ose shkruajini vetë.

Përsëritje në intervale
Përpiquni ta kujtoni përgjigjen para se të ktheni kartelën. Pastaj vlerësoni sa mirë e mbajtët mend. Nibomo planifikon përsëritjen e radhës sipas vlerësimit tuaj. Kartelat më të vështira shfaqen më shpejt.

Ushtroni fjalorin
Krijoni kartela për fjalët që gjeni në libra ose dëgjoni në biseda. Shtoni nga një fjali shembull për të mbajtur mend përdorimin e tyre. Mund të nisni edhe nga një grup kartelash në katalogun e Nibomo.

Përsëritni pa internet
Hapni kartelat e ruajtura gjatë udhëtimit ose mes orëve të mësimit. Kur të lidheni sërish me internetin, mund ta sinkronizoni përparimin duke përdorur të njëjtën llogari në pajisjet tuaja.

Funksionet me IA kërkojnë lidhje me internetin.

## Amharic - am

### App Name

Nibomo: የማጠናከሪያ ካርዶች

### Short Description

ከማስታወሻና ከፎቶ የጥናት ካርዶች ይሥሩ። ያስቀመጧቸውን ያለ ኢንተርኔት ይከልሱ።

### Full Description

በNibomo የክፍል ማስታወሻዎችን፣ ፎቶዎችን ወይም ሊያጠኑት የሚፈልጉትን ርዕስ ወደ የማጠናከሪያ ካርዶች ይቀይሩ። የራስዎን የካርድ ስብስብ ይፍጠሩ እና በየጊዜው በመከለስ ያጠኑትን ያስታውሱ።

ከጥናት ቁሳቁሶችዎ ካርዶች ይሥሩ
የክፍል ማስታወሻዎን ይለጥፉ፣ የደብተር ገጽ ፎቶ ያክሉ ወይም ርዕሱን ይግለጹ። ሊያስታውሷቸው ስለሚፈልጉት ትርጓሜዎች፣ ምሳሌዎች ወይም ቁልፍ ነጥቦች ጥያቄና መልስ እንዲያዘጋጅ AIን ይጠይቁ። ጥያቄዎቹንና መልሶቹን ያርትዑ ወይም ካርዶቹን አንድ በአንድ ራስዎ ይጻፉ።

የተማሩትን በተወሰኑ ክፍተቶች ይድገሙ
ካርዱን ከመገልበጥዎ በፊት መልሱን ለማስታወስ ይሞክሩ። ከዚያ መልሱን ምን ያህል እንዳስታወሱ ይመዝግቡ። Nibomo በዚህ መሠረት የሚቀጥለውን የክለሳ ጊዜ ይወስናል። አስቸጋሪ ካርዶች ቶሎ ይመለሳሉ፣ በደንብ የሚያውቋቸው ካርዶች ደግሞ ቆይተው ይታያሉ።

የእንግሊዝኛ ቃላትን ይለማመዱ
በክፍል፣ በመጽሐፍ ወይም በውይይት ያገኟቸውን አዲስ ቃላት በካርድ ላይ ይጻፉ። የቃሉን አጠቃቀም ለማስታወስ የምሳሌ ዓረፍተ ነገር ያክሉ። ከNibomo ካታሎግ እንደ የእንግሊዝኛ ሐረግ ግሦች ወይም የጀማሪ የስፓኒሽ ቃላት ያሉ ዝግጁ ስብስቦችን መምረጥ ይችላሉ።

ያስቀመጧቸውን ካርዶች ያለ ኢንተርኔት ይከልሱ
በመንገድ ላይ ወይም በክፍል ዕረፍት ጊዜ ያስቀመጧቸውን ካርዶች ይክፈቱ። እንደገና ከኢንተርኔት ጋር ሲገናኙ በተመሳሳይ መለያ ገብተው የጥናት ሂደትዎን በመሣሪያዎችዎ መካከል ማመሳሰል ይችላሉ።

የAI ባህሪያት የኢንተርኔት ግንኙነት ይፈልጋሉ።

## Armenian - hy-AM

### App Name

Nibomo: Ֆլեշքարտեր

### Short Description

Ստեղծեք քարտեր գրառումներից ու լուսանկարներից։ Կրկնեք առանց ինտերնետի։

### Full Description

Nibomo-ով ձեր գրառումներից, լուսանկարներից կամ ընտրված թեմայից ստեղծեք ուսումնական քարտեր։ Կազմեք քարտերի ձեր հավաքածուները և կրկնեք սովորածը տարբեր ժամանակային ընդմիջումներով։

Գրառումներից ստեղծեք ֆլեշքարտեր
Տեղադրեք դասի գրառումները, կցեք տետրի էջի լուսանկարը կամ նկարագրեք թեման։ Խնդրեք արհեստական բանականությանն առաջարկել հարցեր ու պատասխաններ կարևոր հասկացությունների, փաստերի կամ օրինակների մասին։ Խմբագրեք առաջարկները կամ քարտերը գրեք ինքներդ։

Կրկնեք ժամանակային ընդմիջումներով
Փորձեք հիշել պատասխանը մինչև քարտը շրջելը։ Ապա նշեք, թե որքան լավ հիշեցիք այն։ Nibomo-ն ձեր գնահատականով է որոշում հաջորդ կրկնության ժամանակը։ Դժվար քարտերն ավելի շուտ են նորից հայտնվում։

Սովորեք նոր բառեր
Ստեղծեք անգլերեն բառերի քարտեր դասի, գրքի կամ զրույցի ընթացքում հանդիպած բառերից։ Ավելացրեք ձեր օրինակները, որպեսզի հիշեք բառերի կիրառությունը։ Կարող եք սկսել նաև Nibomo-ի կատալոգում եղած պատրաստի հավաքածուից։

Կրկնեք առանց ինտերնետի
Բացեք արդեն պահպանված քարտերը ճանապարհին կամ դասերի միջև։ Երբ նորից ինտերնետ ունենաք, նույն հաշվով մուտք գործեք՝ ձեր առաջընթացը սարքերի միջև համաժամացնելու համար։

Արհեստական բանականության գործառույթների համար անհրաժեշտ է ինտերնետ կապ։

## Azerbaijani - az-AZ

### App Name

Nibomo: Fləşkartlar

### Short Description

Qeydlərdən və şəkillərdən fləşkart yaradın. İnternetsiz də təkrar edin.

### Full Description

Dərs qeydlərinizi, şəkillərinizi və öyrənmək istədiyiniz mövzuları Nibomo ilə fləşkartlara çevirin. Öz öyrənmə kartlarınızı hazırlayın və öyrəndiklərinizi aralıqlı təkrarla yadda saxlayın.

Öz materiallarınızdan kart yaradın
Dərs qeydlərinizi yapışdırın, dəftər səhifəsinin şəklini əlavə edin və ya mövzunu təsvir edin. Süni intellektdən yadda saxlamaq istədiyiniz anlayışlar, nümunələr və faktlar üzrə suallar və cavablar hazırlamasını istəyin. Təklifləri özünüzə uyğun düzəldin və ya kartları bir-bir özünüz yazın.

Aralıqlı təkrarla öyrəndiklərinizi yadda saxlayın
Kartı çevirməzdən əvvəl cavabı xatırlamağa çalışın. Sonra cavabı nə dərəcədə yaxşı xatırladığınızı qeyd edin. Nibomo növbəti təkrarı buna əsasən planlaşdırır. Çətin kartlar daha tez, yaxşı bildiyiniz kartlar isə daha gec yenidən göstərilir.

İngilis dilində söz ehtiyatınızı artırın
Dərsdə, oxuyarkən və ya söhbət zamanı rast gəldiyiniz sözlərdən fləşkartlar yaradın. Sözün necə işlədildiyini yadda saxlamaq üçün nümunə cümlə əlavə edin. Nibomo kataloqundakı hazır dəstlə də başlaya bilərsiniz. Məsələn, ingilis dilində frazal felləri və ya ispan dilində başlanğıc səviyyəli sözləri məşq edin.

Saxladığınız kartları internetsiz təkrar edin
Yolda və ya dərslər arasında saxlanmış kartları açın. Yenidən internetə qoşulduqda eyni hesabla daxil olaraq irəliləyişinizi cihazlar arasında sinxronlaşdıra bilərsiniz.

Süni intellekt funksiyaları üçün internet bağlantısı lazımdır.

## Basque - eu-ES

### App Name

Nibomo: Oroimen-txartelak

### Short Description

Sortu txartelak apunte eta argazkietatik. Errepasatu konexiorik gabe.

### Full Description

Bihurtu ikasgelako apunteak, argazkiak edo ikasi nahi dituzun gaiak oroimen-txartel (flashcards). Sortu zure txartel-sortak Nibomorekin eta errepasatu ikasitakoa tarteka. Gordetako txartelak konexiorik gabe ere erabil ditzakezu.

Sortu txartelak zure ikasmaterialarekin
Itsatsi apunteak, erantsi koadernoko orri baten argazkia edo deskribatu ikasi nahi duzun gaia. Eskatu adimen artifizialari (AA) definizio, adibide edo ideia nagusiei buruzko galdera eta erantzunen zirriborroa prestatzeko. Egokitu edukia ikasten hasi aurretik, edo idatzi txartelak eskuz, banan-banan.

Gogoratu ikasitakoa errepikapen banatuarekin
Irakurri galdera eta saiatu erantzuna gogoratzen txartelari buelta eman aurretik. Adierazi erantzuna gogoratzea zein erraza edo zaila egin zaizun. Nibomok horren arabera antolatzen du hurrengo errepasoa. Txartel zailak lehenago agertuko dira berriz.

Landu hiztegia
Prestatu txartelak irakurtzean, ikasgelan edo elkarrizketa batean aurkitzen dituzun hitzekin. Gehitu adibideak hitzak testuinguruan gogoratzeko. Nibomoren katalogoko sorta batekin ere has zaitezke, adibidez hasiberrientzako gaztelaniazko hiztegiaren sortarekin.

Errepasatu gordetako txartelak konexiorik gabe. Sarean berriro zaudenean, hasi saioa kontu berarekin gailuen artean aurrerapena sinkronizatzeko. Adimen artifizialeko funtzioek Interneteko konexioa behar dute.

## Belarusian - be

### App Name

Nibomo: Карткі для запамінання

### Short Description

Стварайце карткі з нататак і фота. Паўтарайце матэрыял без інтэрнэту.

### Full Description

Стварайце карткі для запамінання ў Nibomo з нататак, фота або тэмы, якую хочаце вывучыць. Збірайце свае наборы картак і замацоўвайце вывучанае з дапамогай інтэрвальнага паўтарэння.

Карткі з вашых нататак
Устаўце нататкі, далучыце фота старонкі сшытка або апішыце тэму. Папрасіце штучны інтэлект (ШІ) скласці пытанні і адказы па важных азначэннях, прыкладах або фактах. Вы можаце адрэдагаваць прапанаваныя карткі ці напісаць свае з нуля.

Інтэрвальнае паўтарэнне
Паспрабуйце ўспомніць адказ, перш чым перавярнуць картку. Потым ацаніце, наколькі добра вы яго ўспомнілі. Nibomo прызначыць наступнае паўтарэнне з улікам вашай ацэнкі. Складаныя карткі з’явяцца раней, а знаёмыя — пазней.

Папаўняйце слоўнікавы запас
Рабіце слоўнікавыя карткі са словамі, якія сустрэлі ў кнізе, на занятках або ў размове. Дадавайце прыклады сказаў, каб запомніць ужыванне слоў. Можна таксама выбраць гатовы набор з каталога Nibomo.

Паўтарайце без інтэрнэту
Адкрывайце захаваныя карткі ў дарозе або паміж заняткамі. Калі зноў падключыцеся да інтэрнэту, увайдзіце ў той самы ўліковы запіс, каб сінхранізаваць прагрэс паміж прыладамі.

Для функцый ШІ патрэбна падключэнне да інтэрнэту.

## Burmese - my-MM

### App Name

Nibomo: AI Flashcards

### Short Description

မှတ်စုနဲ့ ဓာတ်ပုံကနေ ကတ်လုပ်ပါ။ သိမ်းထားတဲ့ကတ်ကို အော့ဖ်လိုင်းလေ့လာပါ။

### Full Description

အတန်းမှတ်စု၊ စာအုပ်စာမျက်နှာဓာတ်ပုံ ဒါမှမဟုတ် သင်လေ့လာနေတဲ့ အကြောင်းအရာကို Nibomo နဲ့ လေ့လာရေးကတ် (flashcards) အဖြစ် ပြောင်းပါ။ ကိုယ်ပိုင်ကတ်တွေ စုထားပြီး အချိန်ခြားကာ ပြန်လေ့လာနိုင်ပါတယ်။

ကိုယ်ပိုင်စာကတ်တွေ ဖန်တီးပါ
မှတ်စုကို ကူးထည့်ပါ၊ ဓာတ်ပုံတစ်ပုံ ထည့်ပါ၊ ဒါမှမဟုတ် လေ့လာချင်တဲ့ ခေါင်းစဉ်ကို ရေးပါ။ မှတ်မိချင်တဲ့ အဓိပ္ပာယ်၊ ဥပမာနဲ့ အရေးကြီးတဲ့ အချက်တွေကို မေးခွန်းနဲ့ အဖြေပုံစံ ရေးပေးဖို့ AI ကို တောင်းဆိုပါ။ မလေ့လာခင် ပြင်ဆင်နိုင်သလို ကတ်တွေကို ကိုယ်တိုင်လည်း ရေးနိုင်ပါတယ်။

အချိန်ခြားပြီး ပြန်လေ့လာပါ
မေးခွန်းကို ဖတ်ပြီး အဖြေကို အရင်စဉ်းစားပါ။ ကတ်ကို လှန်ပြီး အဖြေကို ဘယ်လောက်မှတ်မိလဲ အမှတ်ပေးပါ။ မှတ်မိဖို့ခက်တဲ့ ကတ်တွေကို Nibomo က စောစောပြန်ပြပေးပြီး မှတ်မိပြီးသားကတ်တွေကို နောက်မှ ပြန်ပြပေးပါတယ်။

ဝေါဟာရ လေ့ကျင့်ပါ
စာသင်ခန်း၊ စာအုပ် ဒါမှမဟုတ် စကားပြောရာမှာ တွေ့တဲ့ အင်္ဂလိပ်စကားလုံးတွေနဲ့ ကိုယ်ပိုင်ကတ်တွေ လုပ်ပါ။ စကားလုံးသုံးပုံကို မှတ်မိဖို့ ကိုယ်ပိုင်ဥပမာဝါကျတွေ ထည့်ပါ။

သိမ်းထားတဲ့ ကတ်တွေကို အင်တာနက်မရှိလည်း ပြန်လေ့လာနိုင်ပါတယ်။ AI သုံးဖို့ အင်တာနက်လိုပါတယ်။

## English (India) - en-IN

### App Name

Nibomo: AI Flashcard Maker

### Short Description

Turn notes and photos into flashcards. Revise saved cards offline.

### Full Description

Make flashcards from class notes, photos and topics you want to remember. Use Nibomo’s AI flashcard maker to create your own study sets and revise them with spaced repetition.

Make cards from your study material
Paste a lecture note, add a photo of a notebook page or describe a topic. Ask AI to draft questions and answers, then edit them to suit what you need to learn. You can also write cards yourself and organise them into decks by subject.

Revise at the right intervals
Try to answer each question before you turn the card over. Rate how well you remembered it. Nibomo brings difficult cards back sooner and leaves longer gaps for cards you know well. Use your own deck to revise for an exam or keep key concepts fresh after class.

Build your English vocabulary
Make vocabulary flashcards for words you find in your reading or hear in conversation. Add an example sentence so you remember how to use the word.

Study saved cards offline
Open your saved cards on the way to class or whenever you have a few minutes. When you’re online, sign in to sync your progress across devices.

AI features need an internet connection.

## English (Singapore) - en-SG

### App Name

Nibomo: AI Flashcard Maker

### Short Description

Make flashcards from notes and photos. Review saved cards offline.

### Full Description

Turn class notes and photos into flashcards with Nibomo. Make your own revision decks, use spaced repetition to review them and study saved cards offline.

Make flashcards for your next revision session
Paste notes, attach a photo of a page or describe what you want to study. AI can draft questions and answers from that material. Edit the cards to focus on what you need, or create your own one at a time.

Use spaced repetition to remember more
Read the question and try to recall the answer before flipping the card. Rate how well you remembered it. Nibomo shows difficult cards again sooner and gives familiar cards a longer interval.

Practise English or Chinese vocabulary
Make a deck from words you encounter in class or while reading. For English, you might pair a word with an example sentence. For Chinese, you can put a character on one side and its meaning on the other.

Review while you’re on the move
Open your saved cards between lessons or on the train without an internet connection. Sign in when you’re back online to sync review progress across devices.

AI features need an internet connection.

## English (South Africa) - en-ZA

### App Name

Nibomo: AI Flashcard Maker

### Short Description

Make flashcards from notes and photos. Revise saved cards without data.

### Full Description

Turn lesson notes, photos or a topic into flashcards for your next revision session. With Nibomo you can build your own decks and revisit them with spaced repetition.

Make revision cards from your own notes
Paste your notes or add a photo of a page. Ask AI to turn the material into questions and answers, then edit the cards. You can also write cards yourself. Build a deck for matric revision from your own school notes, or make one for a module you’re taking at university.

Give difficult cards another look sooner
Try to answer the question before turning the card over. Rate how well you recalled it. Nibomo schedules reviews based on that rating, so familiar cards can wait longer.

Learn new words in context
Make vocabulary flashcards from the words you meet in class, books or conversation. Write your own example sentences and keep the words together in a deck.

Review saved flashcards offline
Go through saved cards on the way to class or whenever you’re without mobile data. When you’re online, sign in to sync progress across devices.

AI features need an internet connection.

## Filipino - fil

### App Name

Nibomo: AI Flashcards

### Short Description

Gumawa ng flashcards mula sa notes at litrato. Mag-review kahit offline.

### Full Description

Gawing flashcards ang notes sa klase, litrato ng notebook, o paksang gusto mong aralin. Sa Nibomo, makakagawa ka ng sarili mong set ng mga card at makakapag-review sa tamang pagitan. Kapag naka-save na ang mga card, magagamit mo ang mga ito kahit walang internet.

Gumawa ng flashcards mula sa sarili mong materyales
I-paste ang notes, magdagdag ng litrato ng isang pahina, o ilarawan ang paksang gusto mong aralin. Hilingin sa AI na bumuo ng mga tanong at sagot tungkol sa mga depinisyon, halimbawa, o detalyeng gusto mong matandaan. Puwede mong baguhin ang mga ito bago mag-review. Puwede ka ring sumulat ng sarili mong mga card.

Balikan ang inaral gamit ang spaced repetition
Basahin ang tanong at subukang alalahanin ang sagot bago baliktarin ang card. I-rate kung gaano mo kahusay naalala ang sagot. Batay rito, itatakda ng Nibomo ang susunod na review. Mas maaga mong mababalikan ang mahihirap na card, at mas mahaba ang pagitan para sa mga sagot na alam mo na.

Palawakin ang iyong talasalitaan
Gumawa ng mga card para sa mga bagong salitang nabasa mo o narinig sa klase o sa usapan. Magdagdag ng sarili mong halimbawang pangungusap para maalala kung paano ginagamit ang bawat salita. Puwede ka ring magsimula sa set na handa nang gamitin mula sa katalogo ng Nibomo, gaya ng pangunahing bokabularyo sa Espanyol.

Mag-review offline gamit ang mga naka-save na card. Kapag may internet ka na ulit, mag-sign in sa parehong account para ma-sync ang iyong progreso sa iba mong device. Kailangan ng internet para gamitin ang AI.

## Galician - gl-ES

### App Name

Nibomo: Tarxetas de estudo

### Short Description

Crea tarxetas con IA a partir de apuntamentos ou fotos. Repasa sen conexión.

### Full Description

Converte apuntamentos, fotos ou temas de estudo en tarxetas de estudo (flashcards) con Nibomo. Crea as túas propias barallas e repasa o que aprendiches con repetición espazada. Unha vez gardadas as tarxetas, podes repasalas sen conexión.

Crea tarxetas cos teus apuntamentos
Pega os apuntamentos, engade unha foto dunha páxina do caderno ou describe o tema que queres estudar. Pídelle á IA que prepare preguntas e respostas a partir das definicións, dos exemplos ou das ideas que queres lembrar. Revisa o borrador e edítao ao teu gusto. Tamén podes crear as tarxetas á man, unha a unha.

Repasa con repetición espazada
Le a pregunta e tenta lembrar a resposta antes de darlle a volta á tarxeta. Indica canto che custou lembrala. Nibomo usa a túa valoración para programar o seguinte repaso. As tarxetas máis difíciles volven antes, e as que xa coñeces volven máis tarde.

Practica vocabulario en contexto
Crea tarxetas coas palabras que atopes nun libro, na clase ou nunha conversa. Engade frases de exemplo para lembrar como se usan. Tamén podes comezar cunha baralla xa preparada do catálogo de Nibomo, como a de vocabulario básico en español.

Abre as tarxetas gardadas para repasar sen conexión. Cando volvas ter Internet, inicia sesión coa mesma conta para sincronizar o teu progreso entre dispositivos. As funcións de IA requiren conexión a Internet.

## Georgian - ka-GE

### App Name

Nibomo: სასწავლო ბარათები

### Short Description

შექმენით ფლეშბარათები ჩანაწერებიდან და ფოტოებიდან. გაიმეორეთ ინტერნეტის გარეშე.

### Full Description

შექმენით ფლეშბარათები ლექციის ჩანაწერებიდან, ფოტოებიდან ან თემიდან, რომლის სწავლაც გსურთ. Nibomo-ში შეგიძლიათ სასწავლო ბარათების დაჯგუფება და მასალის ინტერვალებით გამეორება.

ჩანაწერებიდან სასწავლო ბარათებამდე
ჩასვით ჩანაწერები, დაურთეთ რვეულის გვერდის ფოტო ან აღწერეთ თემა. სთხოვეთ ხელოვნურ ინტელექტს, მოამზადოს კითხვები და პასუხები მნიშვნელოვან ცნებებზე, ფაქტებსა და მაგალითებზე. შეგიძლიათ შეთავაზებული ტექსტის შესწორება ან ბარათების თავად დაწერა.

გამეორება ინტერვალებით
სანამ ბარათს გადააბრუნებთ, სცადეთ პასუხის გახსენება. შემდეგ შეაფასეთ, რამდენად კარგად გაიხსენეთ პასუხი. Nibomo თქვენი შეფასებით განსაზღვრავს შემდეგი გამეორების დროს. რთული ბარათები უფრო მალე გამოჩნდება.

ივარჯიშეთ ახალ სიტყვებზე
შექმენით ბარათები ინგლისური სიტყვებისთვის, რომლებსაც გაკვეთილზე, წიგნში ან საუბარში შეხვდებით. დაამატეთ მაგალითები, რომ დაიმახსოვროთ მათი გამოყენება. შეგიძლიათ Nibomo-ს კატალოგში მზა ნაკრებიც აირჩიოთ.

გაიმეორეთ ინტერნეტის გარეშე
გახსენით შენახული ბარათები გზაში ან გაკვეთილებს შორის. როდესაც ინტერნეტს ისევ დაუკავშირდებით, შედით იმავე ანგარიშით, რომ თქვენი პროგრესი სხვადასხვა მოწყობილობაზე სინქრონიზდეს.

ხელოვნური ინტელექტის ფუნქციებს ინტერნეტკავშირი სჭირდება.

## Kazakh - kk

### App Name

Nibomo: Флешкарталар

### Short Description

Жазбалар мен фотолардан флешкарта жасаңыз. Интернетсіз де қайталаңыз.

### Full Description

Сабақта жазған жазбаларыңызды, фотоларыңызды және үйренгіңіз келетін тақырыптарды Nibomo арқылы флешкарталарға айналдырыңыз. Өз карточка жинағыңызды жасап, оқығаныңызды аралық қайталау арқылы есте сақтаңыз.

Өз материалыңыздан карточка жасаңыз
Дәріс жазбаларын көшіріп қойыңыз, дәптер бетінің фотосын тіркеңіз немесе тақырыпты сипаттаңыз. Жасанды интеллектен есте сақтағыңыз келетін анықтамалар, мысалдар мен негізгі деректер бойынша сұрақтар мен жауаптар құрастыруды сұраңыз. Сұрақтар мен жауаптарды түзетіңіз немесе әр карточканы өзіңіз жазыңыз.

Аралық қайталау
Карточканы аудармай тұрып, жауабын еске түсіріп көріңіз. Содан кейін жауапты қаншалықты жақсы есте сақтағаныңызды белгілеңіз. Nibomo келесі қайталау уақытын соған қарай белгілейді. Қиын карточкалар ертерек, жақсы білетіндеріңіз кейінірек қайта көрсетіледі.

Ағылшын сөздерін жаттаңыз
Сабақта, кітапта немесе әңгімеде кездескен сөздерден карточка жасаңыз. Сөздің қалай қолданылатынын есте сақтау үшін мысал сөйлем қосыңыз. Nibomo каталогынан ағылшын тіліндегі фразалық етістіктер немесе испан тілін үйренуді енді бастағандарға арналған сөздер жинағын таңдай аласыз.

Сақталған карточкаларды интернетсіз қайталаңыз
Жолда немесе сабақ арасында сақталған карточкаларды ашыңыз. Интернетке қайта қосылғанда, бір есептік жазбаны пайдаланып, оқу барысын құрылғылар арасында синхрондай аласыз.

Жасанды интеллект функциялары үшін интернет байланысы қажет.

## Khmer - km-KH

### App Name

Nibomo: កាតសិក្សា AI

### Short Description

បង្កើតកាតពីកំណត់ត្រា ឬរូបថត។ រំលឹកមេរៀនដោយមិនចាំបាច់មានអ៊ីនធឺណិត។

### Full Description

បំប្លែងកំណត់ត្រាក្នុងថ្នាក់ រូបថតទំព័រសៀវភៅ ឬប្រធានបទដែលអ្នកកំពុងរៀន ទៅជាកាតសិក្សា (flashcards) ជាមួយ Nibomo។ បង្កើតសំណុំកាតផ្ទាល់ខ្លួន ហើយរំលឹកមេរៀនតាមចន្លោះពេល។

បង្កើតកាតពីឯកសារសិក្សារបស់អ្នក
បិទភ្ជាប់កំណត់ត្រា ភ្ជាប់រូបថត ឬសរសេរប្រធានបទដែលអ្នកចង់រៀន។ សុំឱ្យ AI រៀបចំសំណួរ និងចម្លើយអំពីនិយមន័យ ឧទាហរណ៍ ឬចំណុចសំខាន់ៗ។ អ្នកអាចកែសម្រួលសំណួរ និងចម្លើយមុនពេលរៀន ឬសរសេរកាតដោយខ្លួនឯង។

រំលឹកតាមចន្លោះពេល
អានសំណួរ ហើយព្យាយាមនឹកចម្លើយមុនពេលមើលចម្លើយនៅម្ខាងទៀតនៃកាត។ បន្ទាប់មក បញ្ជាក់ថាអ្នកចាំចម្លើយបានល្អកម្រិតណា។ Nibomo នឹងបង្ហាញកាតដែលពិបាកចាំឆាប់ជាងកាតដែលអ្នកចាំបានល្អ។

ហាត់ពាក្យអង់គ្លេស
បង្កើតកាតពាក្យពីពាក្យអង់គ្លេសដែលអ្នកជួបនៅក្នុងថ្នាក់ ក្នុងសៀវភៅ ឬក្នុងការសន្ទនា។ បន្ថែមប្រយោគជាឧទាហរណ៍ ដើម្បីចងចាំរបៀបប្រើពាក្យនីមួយៗ។

អ្នកអាចរំលឹកមេរៀនជាមួយកាតដែលបានរក្សាទុក ទោះបីគ្មានអ៊ីនធឺណិតក៏ដោយ។ មុខងារ AI ត្រូវការអ៊ីនធឺណិត។

## Kyrgyz - ky-KG

### App Name

Nibomo: Флешкарталар

### Short Description

Конспекттен жана сүрөттөн флешкарта түзүңүз. Интернетсиз да кайталаңыз.

### Full Description

Сабактын конспекттерин, сүрөттөрдү жана үйрөнгүңүз келген темаларды Nibomo менен флешкарталарга айлантыңыз. Өзүңүздүн карта топтомуңузду түзүп, аралык кайталоо менен окуганыңызды эсте сактаңыз.

Өз материалыңыздан карта түзүңүз
Конспектиңизди чаптаңыз, дептердин бетин сүрөткө тартып тиркеңиз же теманы сүрөттөп бериңиз. Жасалма интеллекттен эсте калтыргыңыз келген аныктамалар, мисалдар же маанилүү маалыматтар боюнча суроо-жооп түзүүнү сураңыз. Суроо-жоопторду өзүңүзгө ылайык оңдоңуз же карталарды бирден өзүңүз жазыңыз.

Аралык кайталоо менен эсте сактаңыз
Картаны оодарардан мурун жоопту эстеп көрүңүз. Анан жоопту канчалык жакшы эстегениңизди белгилеңиз. Nibomo кийинки кайталоонун убактысын ошого жараша аныктайт. Кыйын карталар эртерээк, жакшы билген карталарыңыз кийинчерээк кайра көрсөтүлөт.

Англисче сөздөрдү жаттаңыз
Сабакта, китепте же сүйлөшүүдө жолуккан сөздөрдөн флешкарталарды түзүңүз. Сөздүн кандай колдонуларын эстеш үчүн мисал сүйлөм кошуңуз. Nibomo каталогунан англис тилиндеги фразалык этиштер же испан тилин жаңы үйрөнгөндөр үчүн даяр топтом тандасаңыз болот.

Сакталган карталарды интернетсиз кайталаңыз
Жолдо же сабактардын ортосунда сакталган карталарды ачыңыз. Кайра интернетке туташканда, ошол эле каттоо эсеби менен кирип, жетишкендиктериңизди түзмөктөр арасында шайкештештире аласыз.

Жасалма интеллект функциялары үчүн интернет байланышы керек.

## Lao - lo-LA

### App Name

Nibomo: AI Flashcards

### Short Description

ສ້າງບັດຈາກບັນທຶກແລະຮູບຖ່າຍ. ທົບທວນບັດທີ່ບັນທຶກໄວ້ໄດ້ເຖິງຈະບໍ່ມີອິນເຕີເນັດ.

### Full Description

ໃຊ້ Nibomo ປ່ຽນບັນທຶກຈາກຫ້ອງຮຽນ, ຮູບຖ່າຍໜ້າປຶ້ມ ຫຼື ຫົວຂໍ້ທີ່ກຳລັງຮຽນ ໃຫ້ເປັນບັດສຳລັບທົບທວນ (flashcards). ສ້າງຊຸດບັດຂອງຕົນເອງ ແລະ ທົບທວນແບບເວັ້ນໄລຍະ.

ສ້າງບັດຈາກບັນທຶກ ຫຼື ຮູບຖ່າຍ
ວາງຂໍ້ຄວາມຈາກບັນທຶກ, ແນບຮູບຖ່າຍ ຫຼື ບອກຫົວຂໍ້ທີ່ຢາກຮຽນ. ໃຫ້ AI ຊ່ວຍຮ່າງຄຳຖາມ ແລະ ຄຳຕອບຈາກຄຳນິຍາມ, ຕົວຢ່າງ ຫຼື ຈຸດສຳຄັນ. ແກ້ໄຂກ່ອນເລີ່ມຮຽນ ຫຼື ຂຽນບັດດ້ວຍຕົນເອງກໍໄດ້.

ທົບທວນແບບເວັ້ນໄລຍະ
ອ່ານຄຳຖາມ ແລະ ລອງນຶກຄຳຕອບກ່ອນປີ້ນບັດ. ຈາກນັ້ນປະເມີນວ່າຈື່ຄຳຕອບໄດ້ດີປານໃດ. Nibomo ຈັດເວລາທົບທວນຕາມຜົນປະເມີນ. ບັດທີ່ຈື່ຍາກຈະກັບມາໄວກວ່າບັດທີ່ຈື່ໄດ້ດີ.

ຝຶກຄຳສັບອັງກິດ
ສ້າງບັດຄຳສັບຈາກຄຳທີ່ພົບໃນຫ້ອງຮຽນ, ໃນປຶ້ມ ຫຼື ໃນການສົນທະນາ. ເພີ່ມປະໂຫຍກຕົວຢ່າງເພື່ອຈື່ວິທີໃຊ້ແຕ່ລະຄຳ.

ທົບທວນບັດທີ່ບັນທຶກໄວ້ໄດ້ເຖິງຈະບໍ່ມີອິນເຕີເນັດ. ການໃຊ້ AI ຕ້ອງເຊື່ອມຕໍ່ອິນເຕີເນັດ.

## Macedonian - mk-MK

### App Name

Nibomo: Флеш картички

### Short Description

Направете картички од белешки и фотографии. Повторувајте и офлајн.

### Full Description

Направете флеш картички во Nibomo од белешки, фотографија или тема што сакате да ја проучите. Организирајте ги картичките за учење во свои збирки и повторувајте го материјалот во интервали.

Од белешки до картички
Вметнете ги белешките, додајте фотографија од страница во тетратка или опишете ја темата. Побарајте од вештачката интелигенција да предложи прашања и одговори за важните поими, факти или примери. Уредете ги пред учење или напишете ги картичките сами.

Интервално повторување
Обидете се да се сетите на одговорот пред да ја превртите картичката. Потоа оценете колку добро се сетивте. Nibomo го планира следното повторување според вашата оценка. Потешките картички се појавуваат порано, а познатите подоцна.

Вежбајте нови зборови
Направете картички за англиски зборови што ги среќавате во книги, на час или во разговор. Додајте свои примери за да запомните како се користат. Може да почнете и со готова збирка од каталогот на Nibomo.

Повторувајте офлајн
Отворете ги зачуваните картички во движење или меѓу часови. Кога повторно ќе се поврзете на интернет, најавете се со истата сметка за да го синхронизирате напредокот меѓу уредите.

За функциите со вештачка интелигенција е потребен интернет.

## Mongolian - mn-MN

### App Name

Nibomo: Флаш карт

### Short Description

Тэмдэглэл, зургаас флаш карт хийгээрэй. Интернэтгүй үед ч давтаарай.

### Full Description

Хичээлийн тэмдэглэл, зураг болон сурахыг хүссэн сэдвээ Nibomo ашиглан флаш карт болгоорой. Өөрийн картын багцыг бүтээж, сурсан зүйлээ зайтай давталтаар тогтоогоорой.

Өөрийн материалаар флаш карт хийх
Хичээлийн тэмдэглэлээ хуулж оруулах, дэвтрийн хуудасны зураг хавсаргах эсвэл сэдвээ тайлбарлах боломжтой. Тогтоохыг хүссэн тодорхойлолт, жишээ, гол баримтаар асуулт, хариулт гаргахыг хиймэл оюун ухаанаас хүсээрэй. Бэлдсэн асуулт, хариултыг засах эсвэл карт бүрээ өөрөө бичиж болно.

Зайтай давталтаар тогтоох
Картаа эргүүлэхээсээ өмнө хариултаа санахыг хичээгээрэй. Дараа нь хэр сайн санаснаа тэмдэглээрэй. Nibomo дараагийн давталтын хугацааг үүнд үндэслэн товлоно. Хэцүү картууд эрт, сайн мэддэг картууд арай хожуу дахин гарч ирнэ.

Англи үг цээжлэх
Хичээл, ном, ярианаас таарсан шинэ үгсээр флаш карт хийгээрэй. Үгийг хэрхэн хэрэглэхийг тогтоохын тулд жишээ өгүүлбэр нэмээрэй. Nibomo-ийн каталогоос англи хэлний хэлц үйл үг эсвэл анхан шатны испани үгийн сангийн бэлэн багцыг сонгож болно.

Хадгалсан картаа интернэтгүй үед ч давтах
Замд явж байхдаа эсвэл хичээлийн завсарлагаар хадгалсан картаа нээгээрэй. Интернэтэд дахин холбогдоод ижил бүртгэлээр нэвтэрч, суралцсан явцаа төхөөрөмжүүдийнхээ хооронд синк хийж болно.

Хиймэл оюун ухааны боломжуудыг ашиглахад интернэт холболт шаардлагатай.

## Nepali - ne-NP

### App Name

Nibomo: AI फ्ल्यासकार्ड

### Short Description

नोट वा फोटोबाट फ्ल्यासकार्ड बनाउनुहोस्। अफलाइन पनि दोहोर्‍याउनुहोस्।

### Full Description

कक्षाका नोट, कापीको पानाको फोटो वा आफूले पढिरहेको विषयलाई Nibomo मा फ्ल्यासकार्डमा बदल्नुहोस्। आफ्नै कार्डका सेट बनाउनुहोस् र समयको अन्तराल राखेर दोहोर्‍याउनुहोस्।

आफ्नै सामग्रीबाट फ्ल्यासकार्ड बनाउनुहोस्
नोट टाँस्नुहोस्, फोटो थप्नुहोस् वा आफूले पढ्न चाहेको विषय लेख्नुहोस्। परिभाषा, उदाहरण वा मुख्य बुँदामा आधारित प्रश्न र उत्तरको मस्यौदा बनाउन AI लाई भन्नुहोस्। पढ्नुअघि मस्यौदा सच्याउन सक्नुहुन्छ। कार्ड आफैं लेख्न पनि सक्नुहुन्छ।

अन्तराल राखेर दोहोर्‍याउनुहोस्
प्रश्न पढ्नुहोस् र कार्ड पल्टाउनुअघि उत्तर सम्झने कोसिस गर्नुहोस्। कार्ड पल्टाएपछि उत्तर कति राम्रोसँग सम्झनुभयो भनेर जनाउनुहोस्। त्यसैअनुसार Nibomo ले कार्ड फेरि देखाउने समय मिलाउँछ। गाह्रो लागेका कार्ड छिट्टै फर्कन्छन्, राम्ररी सम्झिएका कार्ड पछि देखिन्छन्।

अंग्रेजी शब्दावली अभ्यास गर्नुहोस्
कक्षा, किताब वा कुराकानीमा भेटेका अंग्रेजी शब्दका लागि फ्ल्यासकार्ड बनाउनुहोस्। ती शब्द कसरी प्रयोग हुन्छन् भनेर सम्झन आफ्नै उदाहरण वाक्य थप्नुहोस्।

सेभ गरिएका कार्ड इन्टरनेट नभए पनि दोहोर्‍याउन सक्नुहुन्छ। AI सुविधा प्रयोग गर्न इन्टरनेट चाहिन्छ।

## Persian (Iran) - fa-IR

### App Name

Nibomo: ساخت فلش کارت

### Short Description

از جزوه و عکس با هوش مصنوعی فلش کارت بسازید و کارت‌های ذخیره‌شده را مرور کنید.

### Full Description

با Nibomo از جزوه، عکس یا موضوعی که در حال مطالعهٔ آن هستید فلش کارت بسازید. با تکرار فاصله‌دار مطالب را مرور کنید و کارت‌هایی را که ذخیره کرده‌اید بدون اینترنت هم بخوانید.

ساخت فلش کارت از جزوه و عکس
متن جزوه را وارد کنید، عکسی از صفحهٔ دفتر بفرستید یا موضوعی بنویسید. از هوش مصنوعی بخواهید برای تعریف‌ها، مثال‌ها و نکته‌های مهم پرسش و پاسخ پیشنهاد کند. قبل از مطالعه کارت‌ها را ویرایش کنید یا خودتان آن‌ها را یکی‌یکی بسازید.

مرور فاصله‌دار
پرسش را بخوانید و پیش از برگرداندن کارت پاسخ را به یاد بیاورید. سپس مشخص کنید چقدر خوب آن را به یاد داشتید. Nibomo زمان مرور بعدی را بر اساس ارزیابی شما تعیین می‌کند و کارت‌های دشوار را زودتر نشان می‌دهد.

تمرین لغات انگلیسی با فلش کارت
برای لغت‌هایی که در کلاس، کتاب یا گفت‌وگو می‌بینید کارت بسازید. یک جملهٔ نمونه هم اضافه کنید تا به یاد بیاورید هر واژه در چه موقعیتی به کار می‌رود.

مرور آفلاین
کارت‌های ذخیره‌شده را در راه یا بین کلاس‌ها مرور کنید. بعد از اتصال دوباره به اینترنت، با همان حساب وارد شوید تا پیشرفتتان بین دستگاه‌ها همگام شود.

امکانات هوش مصنوعی به اتصال اینترنت نیاز دارند.

## Persian (United Arab Emirates) - fa-AE

### App Name

Nibomo: ساخت فلش کارت

### Short Description

از یادداشت و عکس فلش کارت بسازید. کارت‌های ذخیره‌شده را آفلاین مرور کنید.

### Full Description

با Nibomo از یادداشت‌های کلاس، عکس صفحهٔ دفتر یا موضوعی که می‌خواهید یاد بگیرید فلش کارت بسازید. با مرور فاصله‌دار، کارت‌هایی را که بیشتر به تمرین نیاز دارند زودتر دوباره ببینید.

از مطالب خودتان کارت بسازید
متن یادداشت‌ها را وارد کنید، عکسی اضافه کنید یا موضوعی بنویسید. از هوش مصنوعی بخواهید بر اساس آن پرسش و پاسخ پیشنهاد کند. کارت‌ها را پیش از مطالعه ویرایش کنید یا خودتان آن‌ها را یکی‌یکی بسازید و دسته‌بندی کنید.

در فاصله‌های مناسب مرور کنید
پرسش را بخوانید و قبل از برگرداندن کارت پاسخ را به یاد بیاورید. بعد مشخص کنید چقدر خوب آن را به یاد داشتید. Nibomo بر اساس ارزیابی شما زمان مرور بعدی را تعیین می‌کند.

لغات انگلیسی را در جمله تمرین کنید
از واژه‌هایی که در کلاس، محل کار یا گفت‌وگو می‌شنوید فلش کارت بسازید. برای هر واژه یک جملهٔ نمونه بنویسید تا کاربرد آن را هم به یاد بسپارید.

کارت‌های ذخیره‌شده را بدون اینترنت مرور کنید
در مسیر یا بین کلاس‌ها کارت‌هایتان را آفلاین مرور کنید. وقتی دوباره به اینترنت وصل شدید، با همان حساب وارد شوید تا پیشرفتتان بین دستگاه‌ها همگام شود.

امکانات هوش مصنوعی به اتصال اینترنت نیاز دارند.

## Persian / Dari (Afghanistan) - fa-AF

### App Name

Nibomo: ساخت فلش کارت

### Short Description

از یادداشت و عکس فلش کارت بسازید. کارت‌های ذخیره‌شده را بدون انترنت مرور کنید.

### Full Description

با Nibomo از یادداشت‌های صنف، عکس صفحۀ کتابچه یا موضوعی که می‌خواهید یاد بگیرید فلش کارت بسازید. کارت‌هایتان را در دسته‌ها تنظیم کنید و درس را در فاصله‌های مناسب مرور کنید.

از یادداشت‌هایتان فلش کارت بسازید
یادداشت را وارد کنید، عکس بگذارید یا موضوع درس را بنویسید. از هوش مصنوعی بخواهید برای نکته‌های مهم سوال و جواب پیشنهاد کند. پیش از مطالعه می‌توانید کارت‌ها را تغییر دهید یا خودتان هر کارت را بنویسید.

درس را در فاصله‌های مناسب مرور کنید
سوال را بخوانید و پیش از برگرداندن کارت، جواب را به یاد بیاورید. بعد مشخص کنید که جواب چقدر به یادتان مانده بود. Nibomo کارت‌های دشوار را زودتر برای مرور دوباره نشان می‌دهد.

لغات انگلیسی را تمرین کنید
از لغاتی که در صنف، کتاب یا گفتگو می‌بینید فلش کارت بسازید. برای هر کلمه یک جملهٔ نمونه اضافه کنید تا به یاد داشته باشید در کجا و چگونه به کار می‌رود.

کارت‌های ذخیره‌شده را بدون انترنت مرور کنید
در راه یا بین درس‌ها، کارت‌های ذخیره‌شده را بدون انترنت باز کنید. وقتی دوباره وصل شدید، با همان حساب وارد شوید تا پیشرفت‌تان در دستگاه‌های دیگر هم به‌روز شود.

امکانات هوش مصنوعی به انترنت نیاز دارند.

## Romansh - rm

### App Name

Nibomo: Cartas d’emprender

### Short Description

Creai cartas cun Vossas notizias e fotos. Repetai senza internet.

### Full Description

Faschai cartas d’emprender (flashcards) cun Vossas notizias da scola, fotografias u temas che Vus vulais emprender. Cun Nibomo pudais Vus crear Voss agens sets da cartas e repeter la materia en intervals.

Creai cartas cun Voss material
Agiuntai Vossas notizias u ina foto d’ina pagina. Vus pudais era descriver in tema. Dumandai a l’intelligenza artifiziala (IA) da preparar dumondas e respostas davart las noziuns, ils exempels u ils fatgs che Vus vulais tegnair endament. Vus pudais modifitgar il sboz u scriver mintga carta a maun.

Repetai en intervals
Legiai la dumonda ed empruvai da As regurdar da la resposta avant da volver la carta. Inditgai quant facil ch’igl è stà da tegnair endament la resposta. Nibomo determinescha cura che Vus duais repeter la carta. Las cartas pli difficilas cumparan pli baud.

Exercitai Voss vocabulari
Creai cartas cun pleds novs da la scola, d’in cudesch u d’ina conversaziun. Agiuntai ina frasa sco exempel per tegnair endament co duvrar il pled.

Vus pudais repeter las cartas arcunadas era senza internet. Cura che Vus essas puspè online, As annunziai cun il medem conto per sincronisar Voss progress tranter differents apparats. Per utilisar las funcziuns da l’IA dovrais Vus ina colliaziun cun l’internet.

## Serbian - sr

### App Name

Nibomo: Флеш картице

### Short Description

Направите флеш картице од бележака и фотографија. Понављајте и офлајн.

### Full Description

Направите флеш картице у апликацији Nibomo од бележака, фотографија или теме коју учите. Организујте картице за учење у своје збирке и обнављајте градиво у размацима.

Од бележака до картица
Налепите белешке са часа, приложите фотографију странице свеске или опишите тему. Затражите од вештачке интелигенције да предложи питања и одговоре за важне појмове, примере и чињенице. Можете да уредите предлоге или да сами напишете сваку картицу.

Размакнуто понављање
Покушајте да се сетите одговора пре него што окренете картицу. Затим оцените колико сте га добро запамтили. Nibomo заказује следеће понављање према вашој оцени. Теже картице се враћају раније, а познате касније.

Вежбајте нове речи
Направите картице за енглеске речи које срећете на часу, у књизи или у разговору. Додајте своје примере реченица да бисте запамтили како се речи користе. Можете да почнете и са готовом збирком из каталога Nibomo.

Понављајте офлајн
Отворите сачуване картице у превозу или између часова. Када поново имате интернет, пријавите се на исти налог да бисте синхронизовали напредак између уређаја.

За функције вештачке интелигенције потребна је интернет веза.

## Sinhala - si-LK

### App Name

Nibomo: AI ෆ්ලෑෂ් කාඩ්

### Short Description

සටහන් හෝ ඡායාරූපවලින් කාඩ් සාදන්න. සුරැකූ කාඩ් අන්තර්ජාලය නැතිවත් බලන්න.

### Full Description

පන්තියේ සටහන්, පොතක පිටුවක ඡායාරූපයක් හෝ ඔබ ඉගෙන ගන්නා මාතෘකාවක් Nibomo සමඟ ෆ්ලෑෂ් කාඩ්පත් බවට පත් කරන්න. ඔබේම කාඩ් කට්ටල සාදා, සුදුසු කාල පරතරවලදී නැවත පාඩම් කරන්න.

ඔබේ සටහන්වලින් කාඩ්පත් සාදන්න
සටහන් අලවන්න, ඡායාරූපයක් එක් කරන්න, නැත්නම් ඔබට ඉගෙන ගැනීමට අවශ්‍ය මාතෘකාව ලියන්න. නිර්වචන, උදාහරණ හෝ වැදගත් කරුණු අනුව ප්‍රශ්න සහ පිළිතුරු යෝජනා කරන්නැයි AI වෙතින් ඉල්ලන්න. පාඩම් කිරීමට පෙර ඒවා වෙනස් කරන්න. ඔබටම කාඩ්පත් ලියන්නත් පුළුවන්.

කාල පරතර තබා නැවත පුහුණු වන්න
ප්‍රශ්නය කියවා කාඩ්පත පෙරළීමට පෙර පිළිතුර මතක් කරගන්න. පිළිතුර දැකීමෙන් පසු එය කොතරම් හොඳින් මතක් වුණාදැයි සටහන් කරන්න. මතක් කරගැනීමට අපහසු කාඩ්පත් Nibomo ඉක්මනින් නැවත පෙන්වයි. හොඳින් මතක ඇති කාඩ්පත් පසුව පෙන්වයි.

ඉංග්‍රීසි වචන පුහුණු වන්න
පන්තියේදී, පොතකින් හෝ කතාබහකදී හමුවන ඉංග්‍රීසි වචනවලට කාඩ්පත් සාදන්න. වචනය භාවිත කරන ආකාරය මතක තබා ගැනීමට ඔබේම උදාහරණ වාක්‍යයක් එක් කරන්න.

සුරැකූ කාඩ්පත් අන්තර්ජාල සම්බන්ධතාවක් නැති විටත් නැවත බලන්න පුළුවන්. AI පහසුකම් භාවිතයට අන්තර්ජාල සම්බන්ධතාවක් අවශ්‍යයි.
