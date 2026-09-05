export const products = [
  { id:"anon", category:"social", name:"Анонимный чат 12+", username:"anon_gender_chat_ru_bot", icon:"💬", keywords:["чат","общение","анонимно","рулетка","собеседник"], tagline:"Анонимное общение один на один", description:"Быстрый поиск собеседника, фильтры, жалобы и блокировки." },
  { id:"music", category:"media", name:"Tectra Music", username:"EnglishTalkMatchBot", icon:"🎵", keywords:["музыка","песня","скачать","трек","audio","music"], tagline:"Найти и скачать музыку", description:"Ищет трек по названию или публичной ссылке и возвращает аудио в Telegram." },
  { id:"random", category:"utility", name:"Tectra Random", username:"FocusSprintTimerBot", icon:"🎲", keywords:["рандом","рандомайзер","жребий","победитель","случайный","random"], tagline:"Рандомайзер и жеребьёвки", description:"Числа, выбор из списка, монетка, кубик и перемешивание." },
  { id:"dating", category:"social", name:"Tectra Meet", username:"GameMateFinderRuBot", icon:"💞", keywords:["знакомства","дейтинг","анкеты","город","интересы","dating"], tagline:"Знакомства 18+ по городу и интересам", description:"Анкеты и взаимные симпатии с раскрытием контакта только при мэтче." },
  { id:"moderator", category:"admin", name:"Tectra Moderator", username:"PocketBudgetRuBot", icon:"🛡", keywords:["модератор","антиспам","антифлуд","группа","ссылки","moderation"], tagline:"Защита Telegram-групп", description:"Удаляет нежелательные ссылки и явный флуд; управляется администраторами." },
  { id:"post", category:"admin", name:"Tectra Post Bot", username:"DevTaks_bot", icon:"📝", keywords:["пост","канал","публикация","формат","post","content"], tagline:"Подготовка и публикация постов", description:"Форматирует текст и публикует его в ваши Telegram-каналы." },
  { id:"video", category:"media", name:"Tectra Video Saver", username:"TectraQuizBot", icon:"📥", keywords:["видео","скачать","тикток","youtube","reels","video","download"], tagline:"Скачать видео по публичной ссылке", description:"Получает видео с поддерживаемых публичных платформ без обхода DRM и приватного доступа." },
  { id:"approve", category:"admin", name:"Tectra Auto Approve", username:"TectraPartyBot", icon:"✅", keywords:["заявки","автоприем","вступление","канал","группа","join"], tagline:"Автоприём заявок на вступление", description:"Автоматически принимает join requests в группах и каналах." },
  { id:"nearby", category:"utility", name:"Tectra Nearby", username:"TerraTectraBotsBot", icon:"📍", keywords:["рядом","кафе","аптека","банкомат","ресторан","места","nearby"], tagline:"Найти полезные места рядом", description:"Ищет кафе, рестораны, аптеки, банкоматы, АЗС и отели рядом через OpenStreetMap." }
];

export const contentChannels = [
  {id:"ai",name:"TerraTectra AI Практика",username:"TerraTectraAI",icon:"🧩",tagline:"Прикладной ИИ и автоматизация"},
  {id:"focus",name:"TerraTectra Фокус",username:"TerraTectraFocus",icon:"🎯",tagline:"Задачи и внимание"},
  {id:"money",name:"TerraTectra Деньги",username:"TerraTectraMoney",icon:"💰",tagline:"Бытовые финансы"},
  {id:"fun",name:"Tectra Развлечения",username:"TectraFun",icon:"🎉",tagline:"Развлечения"},
  {id:"quiz",name:"Tectra Квиз",username:"TectraQuiz",icon:"🧠",tagline:"Квизы"}
];
export const categories=[{id:"social",label:"💬 Общение"},{id:"media",label:"🎵 Медиа"},{id:"admin",label:"🛡 Для каналов и групп"},{id:"utility",label:"🧰 Утилиты"}];
export const recommendationIntents=[
  {id:"talk",label:"💬 Анонимно пообщаться",productId:"anon"},{id:"music",label:"🎵 Скачать музыку",productId:"music"},{id:"video",label:"📥 Скачать видео",productId:"video"},{id:"dating",label:"💞 Знакомства",productId:"dating"},{id:"moderate",label:"🛡 Защитить группу",productId:"moderator"},{id:"approve",label:"✅ Принимать заявки",productId:"approve"},{id:"post",label:"📝 Опубликовать пост",productId:"post"},{id:"random",label:"🎲 Выбрать случайно",productId:"random"},{id:"nearby",label:"📍 Найти рядом",productId:"nearby"}
];
export function productLink(product,source="src_family_catalog"){return `https://t.me/${product.username}?start=${source}_${product.id}`;}
export function channelLink(channel){return `https://t.me/${channel.username}`;}
export function productsByCategory(category){return category==="all"?products:products.filter(p=>p.category===category);}
export function searchProducts(query){const stop=new Set(["мне","нужно","хочу","для","чтобы","бот","найти","помоги"]);const words=(query.toLowerCase().replace(/ё/g,"е").match(/[a-zа-я0-9]+/g)||[]).filter(w=>w.length>=3&&!stop.has(w));if(!words.length)return[];return products.map(product=>{const h=[product.name,product.tagline,product.description,...product.keywords].join(" ").toLowerCase().replace(/ё/g,"е");return{product,score:words.reduce((n,w)=>n+(h.includes(w)?1:0),0)};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.product.name.localeCompare(b.product.name,"ru")).map(x=>x.product);}
