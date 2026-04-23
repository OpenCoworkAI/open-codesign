const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  baseColor: '#e5e7eb',
  highlight: '#f3f4f6',
} /*EDITMODE-END*/;

function Box({ width, height, radius = 8, circle = false }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : radius,
        background: `linear-gradient(90deg, ${TWEAK_DEFAULTS.baseColor} 0%, ${TWEAK_DEFAULTS.highlight} 50%, ${TWEAK_DEFAULTS.baseColor} 100%)`,
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s ease-in-out infinite',
      }}
    />
  );
}

function App() {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#f8fafc',
        padding: 32,
        fontFamily: 'system-ui',
        color: '#475569',
      }}
    >
      <style>
        {
          '@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
        }
      </style>
      <div style={{ display: 'grid', gap: 32, maxWidth: 720, margin: '0 auto' }}>
        <section>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Text line</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Box width="80%" height={12} />
            <Box width="60%" height={12} />
            <Box width="90%" height={12} />
          </div>
        </section>
        <section>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Avatar</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Box width={48} height={48} circle />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Box width="40%" height={12} />
              <Box width="60%" height={10} />
            </div>
          </div>
        </section>
        <section>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Card</div>
          <div
            style={{
              background: '#fff',
              padding: 16,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <Box width="100%" height={140} radius={10} />
            <Box width="80%" height={14} />
            <Box width="50%" height={12} />
          </div>
        </section>
        <section>
          <div style={{ fontSize: 12, marginBottom: 8 }}>List row</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Box width={36} height={36} circle />
                <Box width="60%" height={12} />
                <Box width={60} height={24} radius={6} />
              </div>
            ))}
          </div>
        </section>
        <section>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Image</div>
          <Box width="100%" height={220} radius={12} />
        </section>
      </div>
    </div>
  );
}
