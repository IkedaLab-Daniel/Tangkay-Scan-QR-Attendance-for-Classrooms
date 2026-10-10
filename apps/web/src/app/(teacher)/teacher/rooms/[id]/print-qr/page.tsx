'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import { api } from '@/lib/api';

interface StaticQrData {
  staticQrToken: string;
  roomId: string;
  roomName: string;
}

export default function PrintQrPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<StaticQrData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<StaticQrData>(`/api/rooms/${id}/static-qr`)
      .then(setData)
      .catch(() => setError('Could not load QR code. Make sure you are logged in.'));
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p style={{ fontFamily: 'sans-serif', color: '#444', textAlign: 'center' }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p style={{ fontFamily: 'sans-serif', color: '#888' }}>Loading…</p>
      </div>
    );
  }

  const joinUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${data.staticQrToken}`;

  return (
    <>
      {/* Print media styles */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            margin: 0;
          }
        }
        body {
          margin: 0;
          background: #fff;
          font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
        }
      `}</style>

      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
          background: '#fff',
          gap: 32,
        }}
      >
        {/* Room name */}
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#1c1c18',
            margin: 0,
            textAlign: 'center',
          }}
        >
          {data.roomName}
        </h1>

        {/* QR code */}
        <div
          style={{
            padding: 24,
            border: '1px solid #e5e7eb',
            borderRadius: 16,
            background: '#fff',
          }}
        >
          <QRCode value={data.staticQrToken} size={300} />
        </div>

        {/* Instruction */}
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <p style={{ fontSize: 14, color: '#57606a', margin: '0 0 8px', fontWeight: 600 }}>
            Scan this QR code to mark attendance
          </p>
          <p
            style={{
              fontSize: 11,
              color: '#888',
              wordBreak: 'break-all',
              margin: 0,
            }}
          >
            {joinUrl}
          </p>
        </div>

        {/* Print button — hidden in print */}
        <button
          type="button"
          className="no-print"
          onClick={() => window.print()}
          style={{
            padding: '12px 32px',
            borderRadius: 999,
            background: '#126a3a',
            color: '#fff',
            border: 'none',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          🖨️ Print this page
        </button>
      </div>
    </>
  );
}
