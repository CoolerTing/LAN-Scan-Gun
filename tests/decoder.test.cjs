const { test } = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const {
  MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, BarcodeFormat
} = require('@zxing/library');

test('ZXing decodes generated barcode payload including Chinese text', () => {
  const expected = '仓库 A-1234567890';
  const qr = QRCode.create(expected, { errorCorrectionLevel: 'M' });
  const scale = 6;
  const margin = 4;
  const dimension = (qr.modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(dimension * dimension);
  pixels.fill(255);
  for (let row = 0; row < qr.modules.size; row++) {
    for (let col = 0; col < qr.modules.size; col++) {
      if (!qr.modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          pixels[((row + margin) * scale + y) * dimension + (col + margin) * scale + x] = 0;
        }
      }
    }
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, dimension, dimension)));
  const result = new MultiFormatReader().decode(bitmap);
  assert.equal(result.getText(), expected);
  assert.equal(result.getBarcodeFormat(), BarcodeFormat.QR_CODE);
});
