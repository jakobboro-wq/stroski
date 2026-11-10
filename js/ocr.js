// Prepoznavanje besedila na sliki računa, v celoti na napravi (Tesseract, odprta koda).
// Slika ne zapusti naprave. Ob prvi uporabi se naloži bralnik in slovenski jezik (~5 MB), nato ostaneta v predpomnilniku.

const VERSION = '5.1.1';
const CDN = 'https://cdn.jsdelivr.net/npm';
const SCRIPT = `${CDN}/tesseract.js@${VERSION}/dist/tesseract.min.js`;
const SCRIPT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.integrity = SCRIPT_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { loading = null; reject(new Error('Bralnika ni bilo mogoče naložiti. Si povezan na internet?')); };
    document.head.append(s);
  });
  return loading;
}

/** Pomanjša in posivi sliko: hitrejše branje, manj šuma. Upošteva zasuk fotografije. */
async function prepare(file) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // Velike fotografije pomanjšaj, majhne povečaj: bralnik najbolje bere srednje velike črke.
  let scale = Math.min(1, 1800 / img.width, 3200 / img.height);
  if (img.width * scale < 1400) scale = Math.min(1400 / img.width, 4000 / img.height);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(img, 0, 0, w, h);
  img.close?.();
  return canvas;
}

/**
 * Prebere besedilo s fotografije. `onProgress(delež 0–1, opis)`.
 * `score(text)`: kako dobro je branje (2 = postavke se ujemajo z vsoto). Če ni dobro, poskusi še drug način.
 * Vrne besedilo po vrsticah.
 */
export async function readReceipt(file, onProgress = () => {}, score = () => 2) {
  let pass = 0;
  onProgress(0, 'Pripravljam sliko …');
  const [Tesseract, canvas] = await Promise.all([loadTesseract(), prepare(file)]);
  const worker = await Tesseract.createWorker('slv', 1, {
    workerPath: `${CDN}/tesseract.js@${VERSION}/dist/worker.min.js`,
    corePath: `${CDN}/tesseract.js-core@${VERSION}`,
    langPath: `${CDN}/@tesseract.js-data/slv@1.0.0/4.0.0_best_int`,
    logger: m => {
      if (m.status === 'recognizing text') onProgress(pass ? 0.65 + 0.35 * m.progress : 0.3 + 0.35 * m.progress, pass ? 'Berem še enkrat, drugače …' : 'Berem račun …');
      else if (/load|initializ/.test(m.status)) onProgress(0.3 * (m.progress || 0), 'Nalagam bralnik (samo prvič je počasneje) …');
    },
  });
  try {
    // 4 = en stolpec besedila različnih velikosti (tipičen račun), 6 = en enoten blok (rezerva).
    // Presledki ostanejo, da so zneski ločeni od imen.
    let best = null;
    for (const mode of ['4', '6']) {
      await worker.setParameters({ tessedit_pageseg_mode: mode, preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(canvas);
      const s = score(data.text);
      if (!best || s > best.s) best = { text: data.text, s };
      if (best.s >= 2) break;
      pass++;
    }
    return best.text;
  } finally {
    await worker.terminate();
  }
}
