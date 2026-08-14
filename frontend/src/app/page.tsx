import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="container" style={{ paddingTop: '2rem' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>FoodShift (試作品)</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          飲食店特化型 AIシフト最適化エンジン (OR-Tools CP-SAT)
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Link href="/admin" className="btn btn-primary" data-testid="link-admin">
            🏢 店長向け: シフト作成・管理画面 (/admin)
          </Link>
          <Link href="/submit" className="btn btn-secondary" data-testid="link-submit">
            📱 スタッフ向け: シフト希望提出 (/submit)
          </Link>
        </div>
      </div>
    </main>
  );
}
