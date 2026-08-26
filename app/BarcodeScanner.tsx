'use client';

import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    // Initialize Scanner on mount
    const scanner = new Html5QrcodeScanner(
      'reader',
      {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ],
      },
      /* verbose= */ false
    );

    scannerRef.current = scanner;

    scanner.render(
      (decodedText) => {
        // On successful scan
        if (scannerRef.current) {
          scannerRef.current.clear().catch(console.error);
        }
        onScan(decodedText);
      },
      (error) => {
        // Scanning in progress... ignore frame decoding errors
      }
    );

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-lg font-bold text-slate-900">Scan Barcode</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 font-bold"
          >
            ✕
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div id="reader" className="w-full"></div>
        </div>

        <p className="text-xs text-slate-500 text-center">
          Center the barcode inside the camera box.
        </p>
      </div>
    </div>
  );
}