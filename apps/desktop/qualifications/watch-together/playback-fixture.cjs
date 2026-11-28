const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const scenes = [
  [
    'Зелёный ведёт три круга. Тут уже вряд ли что-то изменится.',
    'У лидера пустая батарея',
    '1 · СИНИЙ',
  ],
  ['Синий проскочит мост. Он точно успеет до закрытия.', 'Мост поднялся перед синим', '1 · ЖЁЛТЫЙ'],
  [
    'У жёлтого почти нет энергии. Что он вообще задумал?',
    'Жёлтый проехал через зарядку',
    '1 · ЖЁЛТЫЙ',
  ],
  [
    'Красный едет в тупик. Почему он туда свернул?',
    'Красный нашёл короткий тоннель',
    '1 · КРАСНЫЙ',
  ],
  [
    'Зелёный обошёл всех. Теперь у него чистая трасса.',
    'Встречный трафик блокирует зелёного',
    '1 · СИНИЙ',
  ],
  [
    'Синий тормозит перед финишем. Кажется, экономит батарею.',
    'Синий дождался попутного ветра',
    '1 · СИНИЙ',
  ],
  [
    'Красный уже радуется. До финиша осталось двадцать метров.',
    'Красный проехал мимо финиша',
    '1 · ЖЁЛТЫЙ',
  ],
  [
    'Зелёный вернулся на трассу, но до лидера ещё очень далеко.',
    'Зелёный выиграл время на повороте',
    '1 · ЗЕЛЁНЫЙ',
  ],
  [
    'На трассу выкатился теннисный мяч. Пока он далеко от машин.',
    'Мяч укатил финишный флажок',
    'ФИНИШ · ПЕРЕНЕСЁН',
  ],
  [
    'Последний круг. Жёлтый едет с одним процентом заряда.',
    'Жёлтый финишировал накатом',
    'ПОБЕДА · ЖЁЛТЫЙ',
  ],
  [
    'Красный и синий идут рядом. Сейчас узнаем, кто второй.',
    'Синий пропустил красного',
    '2 · КРАСНЫЙ',
  ],
  [
    'Кто-то оставил зарядку прямо после финиша. Смешное место.',
    'Зелёный поехал туда за призом',
    '3 · ЗЕЛЁНЫЙ',
  ],
]

async function writePlaybackFixture(directory) {
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
  if (!$voice) { throw 'The fixture requires a Russian Windows speech voice.' }
  $speaker.SelectVoice($voice.VoiceInfo.Name)
  $phrases = ConvertFrom-Json $env:SHIO_WATCH_FIXTURE_PHRASES
  for ($index = 0; $index -lt $phrases.Count; $index++) {
    $speaker.SetOutputToWaveFile((Join-Path $env:SHIO_WATCH_FIXTURE_PATH "$index.wav"))
    $speaker.Speak($phrases[$index])
    $speaker.SetOutputToNull()
  }
} finally { $speaker.Dispose() }
`
  execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: {
      ...process.env,
      SHIO_WATCH_FIXTURE_PHRASES: JSON.stringify(scenes.map(([phrase]) => phrase)),
      SHIO_WATCH_FIXTURE_PATH: directory,
    },
  })
  const title = 'Shio playback fixture'
  const file = path.join(directory, 'fixture.html')
  await fs.writeFile(
    file,
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
body{background:#182138;color:#e9f0ff;font:24px sans-serif;margin:4vw}
header,aside{display:flex;justify-content:space-between;gap:32px}
h1{font-size:44px;margin:0} #track{background:#273b4f;padding:26px 36px;border:8px double #8a94a2;margin:48px 0}
.lane{height:64px;border-bottom:1px dashed #8391a2;display:flex;align-items:center}
.car{position:relative;width:68px;height:42px;border-radius:8px;transition:left 3s linear,left 3s}
#outcome{font-size:34px} #standings{font-size:15px} #event{font-size:16px}
</style>
<header><h1>Батарейная гонка</h1><div id="standings"></div></header>
<div id="track">${['#57be78', '#3ca0f1', '#f4bb45', '#ef6860']
      .map((color) => `<div class="lane"><div class="car" style="background:${color}"></div></div>`)
      .join('')}</div>
<aside><div id="outcome"></div><div id="event"></div></aside>
<audio></audio>
<script>
const scenes = ${JSON.stringify(scenes)};
const cars = [...document.querySelectorAll('.car')];
const audio = document.querySelector('audio');
audio.volume = 0.28;
let started;
window.fixturePosition = () => started === undefined ? 0 : (performance.now() - started) / 1000;
window.startFixture = () => { started = performance.now(); };
setInterval(() => {
  if (started === undefined) return;
  const time = window.fixturePosition();
  const index = Math.min(scenes.length - 1, Math.floor(time / 24));
  const seconds = time - index * 24;
  const [phrase, outcome, standings] = scenes[index];
  if (Number(audio.dataset.index ?? '-1') !== index) {
    audio.dataset.index = index;
    audio.src = index + '.wav';
    audio.play().catch(() => {});
  }
  const decided = seconds >= 6;
  document.querySelector('#outcome').textContent = decided ? outcome : 'На трассе • круг ' + (index + 1);
  document.querySelector('#standings').textContent = decided ? standings : 'Позиции меняются';
  document.querySelector('#event').textContent = 'Эпизод ' + (index + 1) + ' · ' + (decided ? 'результат' : 'решающий поворот');
  cars.forEach((car, lane) => {
    car.style.left = (15 + ((index * 13 + lane * 23 + (decided ? lane * 5 + 17 : 0)) % 75)) + '%';
  });
}, 250);
</script>`,
  )
  return { url: pathToFileURL(file).href, title }
}

module.exports = { writePlaybackFixture }
