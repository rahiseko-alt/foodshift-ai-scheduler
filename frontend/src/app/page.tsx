import Link from 'next/link';

export default function HomePage() {
  return (
    <main
      className="container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '85dvh',
        paddingTop: '2rem',
        paddingBottom: '2rem',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '560px',
          width: '100%',
          textAlign: 'center',
          padding: '2.5rem 1.75rem',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            backgroundColor: 'var(--primary)',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.75rem',
            marginBottom: '1.25rem',
            boxShadow: '0 4px 12px rgb(37 99 235 / 0.3)',
          }}
        >
          FS
        </div>

        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            marginBottom: '0.5rem',
          }}
        >
          FoodShift
        </h1>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
            marginBottom: '2rem',
          }}
        >
          飲食店特化型 AIシフト自動スケジューラー
          <br />
          <span style={{ fontSize: '0.8125rem', color: 'var(--success)', fontWeight: 600 }}>
            ✓ 労基法18歳未満深夜禁止 100%遵守 / 希望充足率最大化 / 完全ステートレス
          </span>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <Link
            href="/admin"
            className="btn btn-primary"
            data-testid="link-admin"
            style={{ fontSize: '1rem', padding: '0.875rem 1.5rem', minHeight: '48px' }}
          >
            🏢 店長向け: シフト作成・管理画面 (/admin)
          </Link>
          <Link
            href="/submit"
            className="btn btn-secondary"
            data-testid="link-submit"
            style={{ fontSize: '0.9375rem', padding: '0.75rem 1.25rem', minHeight: '46px' }}
          >
            📱 スタッフ向け: シフト希望提出 (/submit)
          </Link>
        </div>

        <div
          style={{
            marginTop: '2rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>OR-Tools</div>
            <div>数理最適化求解</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>0円インフラ</div>
            <div>LocalStorage連携</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>現場UX</div>
            <div>LINE / CSV出力</div>
          </div>
        </div>
      </div>
    </main>
  );
}
