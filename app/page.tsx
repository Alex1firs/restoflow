import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1>Restaurant Ordering SaaS</h1>
      <p>Visit <code>/r/[slug]</code> to view a restaurant.</p>
      <div style={{ marginTop: '2rem' }}>
        <p>Try these samples:</p>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li><Link href="/r/grills-capitol" style={{ color: 'blue' }}>/r/grills-capitol</Link></li>
          <li><Link href="/r/demo-restaurant" style={{ color: 'blue' }}>/r/demo-restaurant</Link></li>
        </ul>
      </div>
    </div>
  );
}
