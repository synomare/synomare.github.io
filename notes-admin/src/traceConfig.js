import { createTrace } from './traces.js';

export const OAUTH_ORIGIN = 'https://synomare-notes-oauth.decap-oauth.workers.dev';
export const QA_PREVIEW = ['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');
export const DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});
export const SURFACES = [
  ['stream', 'STREAM'],
  ['field', 'FIELD'],
  ['folds', 'FOLDS']
];
export const PLATES = [
  ['stream', 'STREAM'],
  ['returned', 'RETURNED'],
  ['questions', 'QUESTIONS'],
  ['tensions', 'TENSIONS'],
  ['unused', 'UNUSED']
];

export function demoTraces() {
  return [
    createTrace({ id: 'tr_demo_05', content: '高次元の構造を見せるというより、どの断面を見ているかを切り替えられる方が正確だ。', motifs: ['射影', '情報構造'], visibility: 'local', date: new Date('2026-08-22T03:41:00Z') }),
    createTrace({ id: 'tr_demo_04', content: '記事は最初から存在する容器ではなく、散らばった断片を一時的に線形化した結果として扱いたい。', motifs: ['線形化', 'Fold'], visibility: 'public', relation: { type: 'continues', target: 'tr_demo_02' }, date: new Date('2026-08-20T11:10:00Z') }),
    createTrace({ id: 'tr_demo_03', content: 'グラフは情報の本当の形なのか？　ノードと線へ押し込む時点で、既にかなりの構造を失っている。', motifs: ['射影', 'グラフ批判'], kind: 'question', visibility: 'local', date: new Date('2026-08-19T14:20:00Z') }),
    createTrace({ id: 'tr_demo_02', content: '語は対象を指すのではなく、複数の映像レイヤーを一時的に一枚へ圧縮しているように感じる。', motifs: ['短歌', '圧縮と展開'], visibility: 'local', date: new Date('2026-08-17T02:48:00Z') }),
    createTrace({ id: 'tr_demo_01', content: 'Twitterに書き込む速度のまま、自分の過去へ接続されていく場所が必要だ。', motifs: ['ライフログ', '入力'], visibility: 'local', date: new Date('2026-07-22T09:00:00Z') })
  ];
}

export function parseOAuthMessage(message) {
  if (typeof message !== 'string' || !message.startsWith('authorization:github:success:')) return '';
  try { return JSON.parse(message.slice('authorization:github:success:'.length)).token || ''; }
  catch { return ''; }
}
