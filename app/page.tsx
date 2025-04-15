export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-6">👋 Welcome to Nima</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">📬 Mail</h2>
          <p>Your latest emails will appear here.</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">🎵 Music</h2>
          <p>Your Spotify favorites and stats.</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">💬 Reddit</h2>
          <p>Reddit threads you're following.</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">📰 Recommendations</h2>
          <p>Shopping tips, articles, and more.</p>
        </div>
      </div>
    </main>
  );
}
