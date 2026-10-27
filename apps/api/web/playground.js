const ids = {"voice": "tts-voice", "language": "tts-language", "emotion": "tts-emotion", "pace": "tts-pace", "energy": "tts-energy", "volume": "tts-volume", "style": "tts-style", "text": "tts-text", "start": "tts-synthesize-btn", "preview": "tts-preview-btn", "send": "tts-send-btn", "finish": "tts-finish-btn", "cancel": "tts-stop-btn", "stream": "tts-stream-status", "result": "tts-player", "download": "tts-download", "voices": "tts-voice-status", "warm": "tts-warmup-btn", "sync": "tts-sync-voices", "health": "tts-health", "refresh": "tts-refresh-health", "error": "tts-error", "file": "asr-file", "recognize": "asr-recognize-btn", "mic": "mic-start-btn", "mic-stop": "mic-stop-btn", "asr": "asr-result-text"}
ids.incremental = 'tts-incremental'
const $ = id => document.getElementById(ids[id] || id)
const messages = {
  ru: {locale:'Интерфейс',theme:'Тема',light:'Светлая',dark:'Тёмная',health:'Готовность API / ASR / Fish',refresh:'Обновить',voice:'Логический голос',language:'Язык речи',emotion:'Семантическая эмоция',pace:'Темп',energy:'Энергия',volume:'Громкость',slow:'Медленно',normal:'Обычно',fast:'Быстро',low:'Низкая',high:'Высокая',soft:'Тихо',loud:'Громко',style:'Подача: до 120 символов, без скобок и управляющих символов',warm:'Подготовить голос',preview:'Прослушать голос',sync:'Синхронизировать референсы',text:'Следующий фрагмент (до 220 символов)',incremental:'Продолжать ввод после первого PCM; завершить ввод отдельно',start:'Начать',send:'Отправить фрагмент',finish:'Завершить ввод',cancel:'Остановить / Cancel',download:'Скачать тестовый WAV',protocol:'Жизненный цикл и ограничения',deliveryHelp:'Подача управляет голосом текущего фрагмента. Она не меняет эмоцию персонажа в Character State. Fish tags формирует сервер.',protocolHelp:'HTTP 2.1 / WebSocket 2: start → ready → text / delivery → audio + Float32 PCM → finish-input → complete. Проверяются sessionId, turnId, sequence и cumulative sampleOffset. Mono Float32 little-endian, sample rate объявляет ready. Cancel ожидает остановки реального inference.',limitsHelp:'Буфер звука ограничен 1,5 секунды; сервер ждёт audio-ack. Тестовый WAV ограничен 600 секундами. Finish input завершает текст, оставшийся звук продолжает играть. После отмены Fish перезагружается и прогревается — это видно в Health.',motionHelp:'ARDY, VRM, лицо, глаза и LipSync принадлежат Electron. Эта страница проверяет Speech API и не запускает генератор движения.',file:'Аудиофайл',recognize:'Распознать файл',mic:'Микрофон · streaming',micStop:'Завершить запись',asrProtocol:'Протокол ASR',notReady:'Сервис ещё не готов',busy:'Сначала завершите текущую сессию',missing:'Выберите файл',cancelled:'Остановлено; inference завершён',cancelling:'Останавливается реальная генерация…',complete:'Завершено',prepared:'Голос подготовлен'},
  en: {locale:'Interface',theme:'Theme',light:'Light',dark:'Dark',health:'API / ASR / Fish readiness',refresh:'Refresh',voice:'Logical voice',language:'Speech language',emotion:'Semantic emotion',pace:'Pace',energy:'Energy',volume:'Volume',slow:'Slow',normal:'Normal',fast:'Fast',low:'Low',high:'High',soft:'Soft',loud:'Loud',style:'Delivery: up to 120 characters, no brackets or control characters',warm:'Prepare voice',preview:'Preview voice',sync:'Sync references',text:'Next commit (up to 220 characters)',incremental:'Continue input after first PCM; finish input separately',start:'Start',send:'Send commit',finish:'Finish input',cancel:'Stop / Cancel',download:'Download test WAV',protocol:'Lifecycle and bounds',deliveryHelp:'Delivery affects the current speech commit. It does not change conversational emotion in Character State. The server renders Fish tags.',protocolHelp:'HTTP 2.1 / WebSocket 2: start → ready → text / delivery → audio + Float32 PCM → finish-input → complete. sessionId, turnId, sequence and cumulative sampleOffset are validated. Mono Float32 little-endian; ready declares the sample rate. Cancel waits for actual inference termination.',limitsHelp:'Playback buffers at most 1.5 seconds; the server waits for audio-ack. Test WAV is capped at 600 seconds. Finish input ends text while remaining audio plays. Forced cancellation reloads and warms Fish; Health reports this state.',motionHelp:'Electron owns ARDY, VRM, face, eyes and LipSync. This page tests Speech API and starts no motion generator.',file:'Audio file',recognize:'Recognize file',mic:'Microphone · streaming',micStop:'Finish recording',asrProtocol:'ASR protocol',notReady:'Service is not ready yet',busy:'Finish the current session first',missing:'Choose a file',cancelled:'Cancelled; inference terminated',cancelling:'Stopping actual inference…',complete:'Complete',prepared:'Voice prepared'},
}
Object.assign(messages.ru, {"legacy0": "Распознавание речи", "legacy1": "Начать запись", "legacy2": "Остановить", "legacy3": "Распознать файл", "legacy4": "Результат", "legacy5": "Текст", "legacy6": "Язык", "legacy7": "Голос", "legacy8": "Emotion / reference", "legacy9": "Refresh voices", "legacy10": "Sync voices", "legacy11": "Темп", "legacy12": "Медленный", "legacy13": "Обычный", "legacy14": "Быстрый", "legacy15": "Энергия", "legacy16": "Низкая", "legacy17": "Обычная", "legacy18": "Высокая", "legacy19": "Громкость", "legacy20": "Тихо", "legacy21": "Обычно", "legacy22": "Громко", "legacy23": "Синтезировать поток", "legacy24": "Preview voice", "legacy25": "Потоковый синтез речи...", "legacy26": "Как задавать подачу речи", "legacy27": "Параметры Fish Audio S2 Pro Streaming", "legacy28": "Параметр", "legacy29": "Выбранные emotion, темп, энергия и громкость передаются как единый delivery intent. Сам текст отправляется в поток без служебных тегов и начинает проигрываться по мере поступления PCM-аудио.", "recording": "Запись с микрофона", "voiceStatus": "Состояние голоса", "repository": "Репозиторий", "start": "Синтез", "text": "Текст", "download": "Скачать WAV", "readyReferences": "референсы", "readyConditioning": "conditioning", "duration": "Длительность", "firstPcm": "Первый PCM", "firstSound": "Начало воспроизведения", "sourceSamples": "Samples", "asrResult": "Текст", "asrLanguage": "Язык"})
Object.assign(messages.en, {"legacy0": "Speech recognition", "legacy1": "Start recording", "legacy2": "Stop", "legacy3": "Recognize file", "legacy4": "Result", "legacy5": "Text", "legacy6": "Language", "legacy7": "Voice", "legacy8": "Emotion / reference", "legacy9": "Refresh voices", "legacy10": "Sync voices", "legacy11": "Pace", "legacy12": "Slow", "legacy13": "Normal", "legacy14": "Fast", "legacy15": "Energy", "legacy16": "Low", "legacy17": "Normal", "legacy18": "High", "legacy19": "Volume", "legacy20": "Soft", "legacy21": "Normal", "legacy22": "Loud", "legacy23": "Synthesize", "legacy24": "Preview voice", "legacy25": "Streaming synthesis…", "legacy26": "Speech delivery", "legacy27": "Fish Audio S2 Pro parameters", "legacy28": "Parameter", "legacy29": "Emotion, pace, energy and volume form a typed delivery intent. Audio starts playing as PCM arrives.", "recording": "Microphone recording", "voiceStatus": "Voice status", "repository": "Repository", "start": "Synthesize", "text": "Text", "download": "Download WAV", "readyReferences": "references", "readyConditioning": "conditioning", "duration": "Duration", "firstPcm": "First PCM", "firstSound": "Playback start", "sourceSamples": "Samples", "asrResult": "Text", "asrLanguage": "Language"})
let locale='ru', active=null, voiceData=null, downloadUrl=null, microphone=null
const t=key=>messages[locale][key]??key
const error=value=>{const target=document.querySelector('#asr.active')?document.getElementById('asr-error'):$('error');target.textContent=value instanceof Error?value.message:String(value);target.style.display='block'}
const guarded=fn=>()=>Promise.resolve().then(fn).catch(error)
const originalHelp = new WeakMap()
function translate(){
  document.documentElement.lang=locale
  for(const element of document.querySelectorAll('[data-i18n]'))element.textContent=t(element.dataset.i18n)
  for(const element of document.querySelectorAll('[data-en-label]')){
    if(!originalHelp.has(element))originalHelp.set(element,[...element.childNodes].map(node=>node.cloneNode(true)))
    element.replaceChildren(...(locale==='en'?[document.createTextNode(element.dataset.enLabel)]:originalHelp.get(element).map(node=>node.cloneNode(true))))
  }
}
$('locale').onchange=()=>{locale=$('locale').value;translate()}
$('theme').onchange=()=>{document.documentElement.dataset.theme=$('theme').value}
translate()
async function json(url,body){const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error((await response.text()).slice(0,1000));return response.json()}
async function health(){$('health').textContent=JSON.stringify(await json('/health'),null,2)}
async function voices(){
  voiceData=await json('/voices');const previous=$('voice').value
  $('voice').replaceChildren(...voiceData.voices.map(voice=>{const option=new Option(`${voice.label} · ${voice.voiceId}`,voice.voiceId);option.disabled=!(voice.referencesAvailable??voice.installed);return option}))
  $('voice').value=voiceData.voices.some(v=>v.voiceId===previous)?previous:voiceData.defaultVoiceId
  $('emotion').replaceChildren(...voiceData.all_emotions.map(id=>new Option(id,id)));$('emotion').value='neutral'
  renderVoiceStatus(); const dataset=document.getElementById('tts-dataset');const selected=dataset.value;dataset.replaceChildren(...(voiceData.datasets||voiceData.repositories||[]).map(item=>new Option(item.label||item.id,item.id)));if([...dataset.options].some(option=>option.value===selected))dataset.value=selected
}
const delivery=()=>({emotion:$('emotion').value,pace:$('pace').value,energy:$('energy').value,volume:$('volume').value,...($('style').value.trim()?{style:$('style').value.trim()}:{})})
function controls(){document.getElementById('tts-loading').classList.toggle('show',!!active);$('preview').disabled=!!active;$('warm').disabled=!!active;$('sync').disabled=!!active;$('voice').disabled=!!active;$('language').disabled=!!active;$('start').disabled=!!active;$('send').disabled=!active?.ready||active.inputFinished||active.cancelled;$('finish').disabled=$('send').disabled;$('cancel').disabled=!active||active.cancelled}
function metrics(run,state){
  document.getElementById('tts-result').style.display='block'
  $('stream').textContent=`${state} · Fish Audio S2 Pro · ${run.emotion||'neutral'}\n${t('firstPcm')}: ${run.firstPcmMs?.toFixed(0)??'—'} ms · ${t('firstSound')}: ${run.firstSoundMs?.toFixed(0)??'—'} ms\n${t('duration')}: ${(run.samples/(run.rate||44100)).toFixed(2)} s · PCM: ${run.audioSequence} · buffer: ${Math.max(0,run.scheduledUntil-run.context.currentTime).toFixed(2)} s`
  $('stream').dataset.metrics=JSON.stringify({state,pcmPackets:run.audioSequence,sourceSamples:run.samples,firstPcmMs:run.firstPcmMs,firstSoundMs:run.firstSoundMs,firstPcmBeforeFinish:run.firstPcmBeforeFinish})
}
function send(run,value){if(run.socket.readyState===WebSocket.OPEN)run.socket.send(JSON.stringify(value))}
function commit(){
  const run=active;let text=$('text').value.trim()
  if(!run?.ready||run.inputFinished||run.cancelled||!text)return
  const emotion=/^\[([a-z_ -]{1,32})\](?!\()/i.exec(text)
  if(emotion&&voiceData.all_emotions.includes(emotion[1].trim().toLowerCase())){$('emotion').value=emotion[1].trim().toLowerCase();text=text.slice(emotion[0].length).trim()}
  const characters=Array.from(text)
  if((run.inputCharacters||0)+characters.length>12000)throw new Error('Text limit: 12000')
  run.inputCharacters=(run.inputCharacters||0)+characters.length
  send(run,{type:'delivery',sequence:run.inputSequence++,delivery:delivery()})
  for(let offset=0;offset<characters.length;offset+=220)send(run,{type:'text',sequence:run.inputSequence++,text:characters.slice(offset,offset+220).join('')})
  metrics(run,'streaming')
}
function finish(){if(active&&!active.inputFinished){active.inputFinished=true;send(active,{type:'finish-input'});controls()}}
function wav(chunks,rate){
  const count=chunks.reduce((sum,pcm)=>sum+pcm.length,0),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer)
  const write=(at,value)=>[...value].forEach((char,i)=>view.setUint8(at+i,char.charCodeAt(0)))
  write(0,'RIFF');view.setUint32(4,36+count*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,count*2,true)
  let offset=44;for(const chunk of chunks)for(const sample of chunk){view.setInt16(offset,Math.max(-1,Math.min(1,sample))*32767,true);offset+=2}return new Blob([buffer],{type:'audio/wav'})
}
async function release(run){if(run.released)return;run.released=true;clearTimeout(run.cancelTimer);for(const source of run.sources){source.onended=null;try{source.stop()}catch{}source.disconnect()}run.sources.clear();for(const wake of run.waiters.splice(0))wake();run.socket.close();await run.context.close();if(active===run)active=null;controls()}
async function cancel(){const run=active;if(!run||run.cancelled)return;run.cancelled=true;for(const source of run.sources){try{source.stop()}catch{}}send(run,{type:'cancel',reason:'web-playground-cancelled'});metrics(run,t('cancelling'));controls();for(const wake of run.waiters.splice(0))wake();run.cancelTimer=setTimeout(()=>{error('Cancellation acknowledgement timeout');void release(run).catch(error)},5000)}
async function start(preview=false){
  if(active)throw new Error(t('busy'));$('error').textContent='';$('error').style.display='none'
  const status=await json('/health');if(!status.synthesis.ready||status.contractVersion!=='2.1'||status.synthesis.protocolVersion!==2)throw new Error(t('notReady'))
  const context=new AudioContext();await context.resume();const id=`web:${crypto.randomUUID()}`,socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/tts/stream`);socket.binaryType='arraybuffer'
  const run={id,socket,context,started:performance.now(),sources:new Set(),waiters:[],chunks:[],inputSequence:0,audioSequence:0,samples:0,pending:null,ready:false,inputFinished:false,cancelled:false,released:false,terminal:false,scheduledUntil:context.currentTime,firstPcmMs:null,firstSoundMs:null,firstPcmBeforeFinish:null,chain:Promise.resolve()};active=run;controls();metrics(run,'connecting')
  const fail=async message=>{error(message);if(!run.terminal)send(run,{type:'cancel',reason:'web-protocol-error'});run.terminal=true;await release(run)}
  socket.onopen=()=>send(run,{type:'start',protocolVersion:2,sessionId:id,turnId:id,voiceId:$('voice').value,language:$('language').value,delivery:delivery()})
  socket.onmessage=event=>{run.chain=run.chain.then(async()=>{
    if(run.released)return
    if(event.data instanceof ArrayBuffer){
      if(run.cancelled)return;const metadata=run.pending;run.pending=null;const pcm=new Float32Array(event.data)
      if(!metadata||pcm.length!==metadata.samples||!pcm.every(Number.isFinite))throw new Error('Invalid PCM payload')
      if(run.firstPcmMs===null){run.firstPcmMs=performance.now()-run.started;run.firstPcmBeforeFinish=!run.inputFinished}
      if(run.samples+pcm.length>run.rate*600)throw new Error('Test WAV duration limit exceeded')
      run.chunks.push(pcm);run.samples+=pcm.length
      while(!run.cancelled&&run.scheduledUntil-context.currentTime>1.5-pcm.length/run.rate)await new Promise(resolve=>run.waiters.push(resolve))
      if(run.cancelled)return
      const buffer=context.createBuffer(1,pcm.length,run.rate);buffer.copyToChannel(pcm,0);const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination)
      const at=Math.max(run.scheduledUntil,context.currentTime+0.03),nonzero=pcm.findIndex(sample=>Math.abs(sample)>0.00001)
      if(run.firstSoundMs===null&&nonzero>=0)run.firstSoundMs=performance.now()-run.started+(at-context.currentTime+nonzero/run.rate)*1000
      run.sources.add(source);source.onended=()=>{source.disconnect();run.sources.delete(source);for(const wake of run.waiters.splice(0))wake();if(run.terminal&&!run.sources.size)void release(run).catch(error)}
      source.start(at);run.scheduledUntil=at+buffer.duration;run.emotion=metadata.emotion;send(run,{type:'audio-ack',sequence:metadata.sequence});metrics(run,'streaming');return
    }
    const message=JSON.parse(event.data)
    if(message.type==='cancelled'){run.terminal=true;metrics(run,t('cancelled'));await release(run);return}if(run.cancelled)return
    if(message.type==='error')throw new Error(`${message.code}: ${message.message}`)
    if(message.type==='ready'){
      if(run.ready||message.sessionId!==id||message.protocolVersion!==2||message.sampleFormat!=='float32-le'||message.channels!==1||!Number.isInteger(message.sampleRate)||message.sampleRate<8000||message.sampleRate>48000)throw new Error('Unsupported stream readiness')
      run.ready=true;run.rate=message.sampleRate;controls()
      if(preview){send(run,{type:'text',sequence:run.inputSequence++,text:$('language').value==='ru'?'Привет! Это проверка голоса.':'Hello! This is a voice preview.'});finish()}else{commit();if(!$('incremental').checked)finish()}
    }else if(message.type==='audio'){
      if(!run.ready||run.pending||message.sessionId!==id||message.turnId!==id||message.sequence!==run.audioSequence||message.sampleOffset!==run.samples||!Number.isInteger(message.samples)||message.samples<=0||message.samples>run.rate*1.5)throw new Error('Invalid audio identity, sequence or source offset')
      run.pending=message;run.audioSequence++
    }else if(message.type==='complete'){
      if(run.pending||message.sessionId!==id||message.sequence!==run.audioSequence)throw new Error('Invalid completion');run.terminal=true;metrics(run,t('complete'))
      if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(wav(run.chunks,run.rate));$('result').src=downloadUrl;$('result').hidden=false;$('download').href=downloadUrl;$('download').hidden=false;if(!run.sources.size)await release(run)
    }else throw new Error('Unexpected stream message')
  }).catch(fail)}
  socket.onerror=()=>void fail('WebSocket transport failure').catch(error)
  socket.onclose=()=>{void run.chain.then(()=>{if(!run.terminal&&!run.released)return fail('Stream disconnected before terminal acknowledgement')}).catch(error)}
}
$('refresh').onclick=guarded(async()=>{await health();await voices()});$('start').onclick=guarded(()=>start());$('send').onclick=guarded(commit);$('finish').onclick=guarded(finish);$('cancel').onclick=guarded(cancel);$('preview').onclick=guarded(()=>start(true))
$('warm').onclick=guarded(async()=>{if(active)throw new Error(t('busy'));await json('/tts/warmup',{voiceId:$('voice').value,language:$('language').value});await health();await voices();$('stream').textContent=t('prepared')})
$('sync').onclick=guarded(async()=>{await json('/voices/sync',{dataset:document.getElementById('tts-dataset').value||undefined,limit:10});await voices()})
$('recognize').onclick=guarded(async()=>{const file=$('file').files[0];if(!file)throw new Error(t('missing'));const form=new FormData();form.append('file',file);const response=await fetch('/recognize',{method:'POST',body:form});if(!response.ok)throw new Error(await response.text());renderRecognition(await response.json())})
let micPlaybackUrl=null
async function stopMic(){
  const mic=microphone;if(!mic)return
  microphone=null;clearTimeout(mic.timeout);mic.node?.disconnect();mic.source?.disconnect();mic.stream.getTracks().forEach(track=>track.stop());await mic.context.close()
  if(mic.socket.readyState===WebSocket.OPEN)mic.socket.send(JSON.stringify({type:'stop'}))
  mic.closeTimer=setTimeout(()=>mic.socket.close(),30000)
  if(mic.chunks.length){
    if(micPlaybackUrl)URL.revokeObjectURL(micPlaybackUrl)
    micPlaybackUrl=URL.createObjectURL(wav(mic.chunks.map(chunk=>Float32Array.from(chunk,sample=>sample/32768)),16000))
    const player=document.getElementById('asr-mic-player');player.src=micPlaybackUrl;player.style.display='block'
  }
  $('mic').disabled=false;$('mic-stop').disabled=true
}
$('mic').onclick=guarded(async()=>{
  if(microphone)return;const stream=await navigator.mediaDevices.getUserMedia({audio:true}),context=new AudioContext(),socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/asr`)
  const mic={stream,context,socket,ready:false,finals:[],chunks:[]};microphone=mic;$('mic').disabled=true;$('mic-stop').disabled=false
  document.getElementById('asr-live').style.display='block';document.getElementById('asr-live-text').textContent='…';document.getElementById('asr-error').style.display='none';document.getElementById('asr-mic-player').style.display='none'
  socket.onopen=()=>socket.send(JSON.stringify({type:'start',protocolVersion:1,sessionId:`asr:${crypto.randomUUID()}`,sampleRate:16000,channels:1,format:'pcm_s16le',language:$('language').value}))
  socket.onmessage=event=>{try{if(microphone&&microphone!==mic)return;const message=JSON.parse(event.data);if(message.type==='ready')mic.ready=true;if(message.type==='error')throw new Error(message.message||message.code);if(message.type==='final')mic.finals.push(message.text);if(message.type==='partial'||message.type==='final')document.getElementById('asr-live-text').textContent=[...mic.finals,...(message.type==='partial'?[message.text]:[])].join(' ')}catch(failure){error(failure)}}
  socket.onerror=()=>{error('ASR WebSocket failure');void stopMic().catch(error)};socket.onclose=()=>{clearTimeout(mic.closeTimer);if(microphone===mic)void stopMic().catch(error)}
  try{await context.audioWorklet.addModule('/static/asr-capture.js');mic.source=context.createMediaStreamSource(stream);mic.node=new AudioWorkletNode(context,'shio-asr-capture');mic.node.port.onmessage=event=>{if(mic.ready&&socket.readyState===WebSocket.OPEN){if(socket.bufferedAmount>64000){error('ASR backpressure');void stopMic().catch(error)}else{mic.chunks.push(new Int16Array(event.data));socket.send(event.data)}}};mic.source.connect(mic.node);const mute=context.createGain();mute.gain.value=0;mic.node.connect(mute).connect(context.destination);mic.timeout=setTimeout(()=>void stopMic().catch(error),120000)}catch(failure){await stopMic();throw failure}
})
$('mic-stop').onclick=guarded(stopMic)
window.addEventListener('beforeunload',()=>{if(active){send(active,{type:'cancel',reason:'page-unload'});void release(active).catch(()=>{})}void stopMic().catch(()=>{});if(downloadUrl)URL.revokeObjectURL(downloadUrl);if(micPlaybackUrl)URL.revokeObjectURL(micPlaybackUrl)})
void Promise.all([health(),voices()]).catch(error)

function renderVoiceStatus(){const voice=voiceData?.voices.find(item=>item.voiceId===$('voice').value);$('voices').textContent=`default=${voiceData?.defaultVoiceId||'—'}; selected=${voice?.voiceId||'—'}; ${t('readyReferences')}=${!!voice?.referencesAvailable}; ${t('readyConditioning')}=${!!voice?.conditioningReady}; sync=${voiceData?.syncState||'unknown'}`}
$('voice').onchange=renderVoiceStatus
document.getElementById('tts-refresh-voices').onclick=guarded(voices)
function renderRecognition(result){document.getElementById('asr-result').style.display='block';$('asr').textContent=`${t('asrResult')}: ${result.text}\n${t('asrLanguage')}: ${result.language}`;document.getElementById('asr-result-segments').textContent=(result.segments||[]).map((segment,index)=>`${index+1}. ${segment.text} [${segment.start.toFixed(2)}–${segment.end.toFixed(2)}s]`).join('\n')}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab===button);for(const panel of document.querySelectorAll('.panel'))panel.classList.toggle('active',panel.id===button.dataset.tab)})
