/**
 * Opt-in live semantic qualification fixtures; never imported by Runtime.
 * These are expected meanings, not a phrase router or evidence of model quality.
 * Run a case only when its expected semantic hints are present in the actual
 * request-scoped Avatar availability. Otherwise record skipped/unavailable.
 * Fixture execution must use the production prompt, Composer and safe parser;
 * preserve the provider/model, catalog/model generation and observed result.
 * A semantic pass never qualifies a motion trajectory or a VRM rig.
 */
const PENDING = 'pending'
const pair = (id, prompts, expectedAllowedHints, forbiddenHints, allowNoHint = false) =>
  Object.entries(prompts).map(([locale, userPrompt]) =>
    Object.freeze({
      id: `${id}-${locale}`,
      locale,
      userPrompt,
      protocolVersion: 2,
      expectedAllowedHints: Object.freeze([...expectedAllowedHints]),
      forbiddenHints: Object.freeze([...forbiddenHints]),
      allowNoHint,
      availabilityPolicy: expectedAllowedHints.length
        ? 'require-supported-semantic-hint'
        : 'presence-only',
      qualificationStatus: PENDING,
    }),
  )

const SEMANTIC_EMBODIMENT_CASES = Object.freeze([
  ...pair(
    'greeting-not-agreement',
    {
      ru: 'Поздоровайся со мной и мягко помаши рукой.',
      en: 'Say hello to me and give a gentle wave.',
    },
    ['greeting'],
    ['agree', 'celebrate'],
  ),
  ...pair(
    'agreement-not-greeting',
    {
      ru: 'Я предлагаю сначала проверить факты. Согласись со мной, если это разумно.',
      en: 'I suggest checking the facts first. Agree with me if that makes sense.',
    },
    ['agree'],
    ['greeting', 'farewell'],
    true,
  ),
  ...pair(
    'thanks-not-celebration',
    {
      ru: 'Я помог тебе разобраться. Поблагодари меня спокойным жестом.',
      en: 'I helped you understand it. Thank me with a calm gesture.',
    },
    ['thanks'],
    ['celebrate', 'greeting'],
  ),
  ...pair(
    'reassurance-not-disagreement',
    {
      ru: 'Мне тревожно перед разговором. Поддержи меня мягким ободряющим жестом.',
      en: 'I am anxious about the conversation. Support me with a gentle reassuring gesture.',
    },
    ['reassure'],
    ['disagree', 'tease'],
  ),
  ...pair(
    'explanation-with-one-open-palm',
    {
      ru: 'Коротко объясни, почему полезно делать паузы в работе, мягко раскрыв одну ладонь.',
      en: 'Briefly explain why taking work breaks helps, gently opening one palm as you explain.',
    },
    ['explain'],
    ['greeting', 'compare', 'celebrate'],
  ),
  ...pair(
    'shy-gather-not-concern',
    {
      ru: 'Смутись, мягко собери кисти перед талией и скажи короткую застенчивую фразу.',
      en: 'Give a shy reaction, gently gathering your hands near your waist, and say a brief bashful phrase.',
    },
    ['shy'],
    ['concern', 'reassure', 'celebrate'],
  ),
  ...pair(
    'sadness-not-shyness',
    {
      ru: 'Мне сегодня грустно. Давай просто тихо побудем рядом.',
      en: 'I feel sad today. Let us just quietly stay together for a while.',
    },
    ['concern', 'reassure'],
    ['shy', 'disagree', 'tease', 'celebrate'],
    true,
  ),
  ...pair(
    'neutral-presence-without-hint',
    {
      ru: 'Сколько будет дважды два? Просто ответь числом.',
      en: 'What is two times two? Just answer with the number.',
    },
    [],
    ['greeting', 'agree', 'celebrate', 'peace', 'fox-paw'],
    true,
  ),
  ...pair(
    'explicit-peace-sign',
    {
      ru: 'Покажи одной рукой знак победы V, пожалуйста.',
      en: 'Please make a V peace sign with one hand.',
    },
    ['peace'],
    ['celebrate', 'greeting', 'fox-paw'],
  ),
  ...pair(
    'explicit-fox-paw',
    {
      ru: 'Покажи милую лисью лапку одной рукой.',
      en: 'Show a cute fox-paw gesture with one hand.',
    },
    ['fox-paw'],
    ['peace', 'greeting', 'tease'],
  ),
])

module.exports = { SEMANTIC_EMBODIMENT_CASES }

// A read-only case listing. This command performs no inference or live validation.
if (require.main === module)
  console.log(
    JSON.stringify(
      { qualificationStatus: PENDING, inferenceExecuted: false, cases: SEMANTIC_EMBODIMENT_CASES },
      null,
      2,
    ),
  )
