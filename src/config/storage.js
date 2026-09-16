/**
 * Storage layer
 * - Cloudinary (when CLOUDINARY_URL is set) → permanent CDN-backed images, survives deploys
 * - Local disk fallback (default) → existing behavior for dev/simple hosting
 * Exposes: upload (multer middleware), imageUrlFor(file), thumbnailUrlFor(url), storageType, deleteImage(url)
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

let upload, imageUrlFor, thumbnailUrlFor, deleteImage, storageType, processUploadedFile;

function useLocalStorage() {
  // Local disk storage
  const sharp = require('sharp');

  const UPLOAD_DIR = path.join(__dirname, '../../uploads/products');
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const unique = `prd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, unique + path.extname(file.originalname).toLowerCase());
    },
  });

  upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\/(jpe?g|png|webp)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error('Only JPG/PNG/WebP images allowed'));
    },
  });

  imageUrlFor = (file) => file ? `/uploads/products/${file.filename}` : null;
  thumbnailUrlFor = (url) => {
    if (!url) return null;
    const ext = path.extname(url);
    return url.replace(ext, `-thumb${ext}`);
  };
  deleteImage = async (url) => {
    if (!url) return;
    const p = path.join(__dirname, '../..', url);
    const thumb = thumbnailUrlFor(p);
    [p, thumb].forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e){} });
  };
  processUploadedFile = async (file) => {
    if (!file) return;
    try {
      const ext = path.extname(file.filename);
      const base = path.basename(file.filename, ext);
      const thumbPath = path.join(UPLOAD_DIR, base + '-thumb' + ext);
      await sharp(file.path).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(file.path + '.tmp');
      fs.renameSync(file.path + '.tmp', file.path);
      await sharp(file.path).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 75 }).toFile(thumbPath);
    } catch(e) { console.error('Image processing error:', e.message); }
  };
  storageType = 'local';
}

try {

if (process.env.CLOUDINARY_URL) {
  if (!String(process.env.CLOUDINARY_URL).startsWith('cloudinary://')) {
    console.log('⚠️  CLOUDINARY_URL is invalid (must start with cloudinary://). Using local storage instead.');
    console.log('   Get it from Cloudinary Dashboard → "API Environment variable"');
    throw new Error('invalid cloudinary url');
  }
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  cloudinary.config({ secure: true });

  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder: 'sales/products',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }],
      public_id: `prd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    }),
  });

  upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

  imageUrlFor = (file) => {
    if (!file) return null;
    return file.secure_url || file.path || null;
  };
  thumbnailUrlFor = (url) => {
    if (!url) return null;
    return url.replace('/upload/', '/upload/w_240,f_auto,q_auto/');
  };
  deleteImage = async (url) => {
    if (!url || url.startsWith('/')) return;
    try {
      const m = url.match(/\/v\d+\/(.+)\.\w+$/);
      if (m) await cloudinary.uploader.destroy(m[1]);
    } catch(e) { console.error('Cloudinary delete error:', e.message); }
  };
  processUploadedFile = async () => {};
  storageType = 'cloudinary';
} else {
  useLocalStorage();
}

} catch(e) {
  if (e.message !== 'invalid cloudinary url') console.error('Storage init error:', e.message);
  useLocalStorage();
}

module.exports = { upload, imageUrlFor, thumbnailUrlFor, deleteImage, processUploadedFile, storageType };
