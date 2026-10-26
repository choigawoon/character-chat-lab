// 화면 굽기(이미지 빌드 때 한 번) — web/ 의 app.js · app.css · icon.svg 를 내용 해시 이름으로 web/assets/ 에 두고 index.html 이 그 이름을 부르게 고친다.
// 이름에 내용 해시가 붙어 브라우저가 오래 들고 있어도 새 판을 받는다(Dockerfile 이 이미지 빌드 때 부른다).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
await mkdir(join(WEB, 'assets'), { recursive: true });
let html = await readFile(join(WEB, 'index.html'), 'utf8');
for (const f of ['app.js', 'app.css', 'icon.svg']) {
  const body = await readFile(join(WEB, f));
  const h = createHash('sha256').update(body).digest('hex').slice(0, 10);
  const name = `${basename(f, extname(f))}.${h}${extname(f)}`;
  await writeFile(join(WEB, 'assets', name), body);
  html = html.replaceAll(`"/${f}"`, `"/assets/${name}"`);
}
await writeFile(join(WEB, 'index.html'), html);
console.log('built', html.match(/\/assets\/[\w.]+/g).join(' '));
