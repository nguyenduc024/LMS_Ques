// Tự tải ảnh bìa album từ iTunes và tạo music/playlist.js.
//
// Cách dùng:
//   1. Điền danh sách vào music/songs.txt (mỗi dòng: Ca sĩ - Tên bài | link YouTube)
//   2. Chạy: node scripts/fetch-covers.mjs
//
// Ảnh đã có trong music/covers/ sẽ được giữ nguyên, nên nếu bìa tải về bị sai,
// bạn chỉ cần thay file ảnh đó bằng tay rồi chạy lại.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SONGS_FILE = path.join(ROOT, 'music', 'songs.txt');
const COVERS_DIR = path.join(ROOT, 'music', 'covers');
const PLAYLIST_FILE = path.join(ROOT, 'music', 'playlist.js');
const SIZE = 600; // kích thước ảnh bìa (px)

// "Sơn Tùng M-TP - Chúng Ta" -> "son-tung-m-tp-chung-ta"
function slugify(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Lấy ID 11 ký tự từ link YouTube (watch?v=, youtu.be/, shorts/, embed/) hoặc ID trần.
function youtubeId(link) {
  if (!link) return '';
  const m = link.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(link) ? link : '';
}

function parseSongs(text) {
  const songs = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [namePart, linkPart = ''] = line.split('|').map((s) => s.trim());
    const dash = namePart.indexOf(' - ');
    if (dash < 0) {
      console.warn('  Bỏ qua (thiếu " - " giữa ca sĩ và tên bài): ' + line);
      continue;
    }
    songs.push({
      artist: namePart.slice(0, dash).trim(),
      title: namePart.slice(dash + 3).trim(),
      youtube: youtubeId(linkPart)
    });
  }
  return songs;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function plain(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

// Tìm bài trên iTunes. Thử cả có dấu lẫn không dấu (bài Việt tìm không dấu hay ra hơn),
// store Việt Nam trước rồi tới Mỹ. Ưu tiên kết quả đúng ca sĩ.
// Trả về { hit, sure }: sure = false nghĩa là không khớp ca sĩ, nên kiểm tra lại.
async function searchItunes(artist, title) {
  const terms = [...new Set([artist + ' ' + title, plain(artist + ' ' + title)])];
  const wantArtist = plain(artist);
  let fallback = null;

  for (const country of ['VN', 'US']) {
    for (const t of terms) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(t)}&entity=song&limit=5&country=${country}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const results = (await res.json()).results || [];
      const match = results.find((r) => {
        const got = plain(r.artistName || '');
        return got.includes(wantArtist) || wantArtist.includes(got);
      });
      if (match) return { hit: match, sure: true };
      if (!fallback && results.length) fallback = results[0];
    }
  }
  return fallback ? { hit: fallback, sure: false } : null;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) return false;
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function main() {
  const songs = parseSongs(await readFile(SONGS_FILE, 'utf8'));
  if (!songs.length) {
    console.log('music/songs.txt chưa có bài nào.');
    return;
  }
  await mkdir(COVERS_DIR, { recursive: true });

  const playlist = [];
  for (const s of songs) {
    const slug = slugify(s.artist + ' ' + s.title);
    const label = `${s.artist} - ${s.title}`;
    let cover = '';

    // Đã có ảnh (tải trước đó hoặc tự thay tay) thì giữ nguyên
    for (const ext of ['webp', 'jpg', 'png']) {
      if (await exists(path.join(COVERS_DIR, `${slug}.${ext}`))) cover = `music/covers/${slug}.${ext}`;
    }

    if (cover) {
      console.log(`  Đã có    ${label}`);
    } else {
      try {
        const found = await searchItunes(s.artist, s.title);
        const hit = found && found.hit;
        if (!hit || !hit.artworkUrl100) {
          console.log(`  KHÔNG TÌM THẤY  ${label}  (sẽ dùng thumbnail YouTube)`);
        } else {
          const base = hit.artworkUrl100.replace(/100x100bb\.\w+$/, `${SIZE}x${SIZE}bb`);
          // Thử webp (nhẹ hơn), không được thì lấy jpg
          for (const ext of ['webp', 'jpg']) {
            if (await download(`${base}.${ext}`, path.join(COVERS_DIR, `${slug}.${ext}`))) {
              cover = `music/covers/${slug}.${ext}`;
              break;
            }
          }
          const tag = found.sure ? 'Đã tải  ' : 'KIỂM TRA';
          console.log(`  ${tag} ${label}\n           -> khớp với: ${hit.artistName} - ${hit.trackName} (album: ${hit.collectionName})`);
        }
      } catch (err) {
        console.log(`  LỖI      ${label}: ${err.message}`);
      }
    }

    playlist.push({ title: s.title, artist: s.artist, youtube: s.youtube, cover });
  }

  const body = playlist.map((p) => '  ' + JSON.stringify(p)).join(',\n');
  await writeFile(
    PLAYLIST_FILE,
    '// File này được tạo tự động bởi scripts/fetch-covers.mjs từ music/songs.txt.\n' +
      '// Muốn sửa danh sách: sửa music/songs.txt rồi chạy lại script.\n' +
      'const PLAYLIST = [\n' + body + '\n];\n'
  );
  console.log(`\nXong: ${playlist.length} bài -> music/playlist.js`);
}

main();
