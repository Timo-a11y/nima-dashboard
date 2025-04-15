import { useEffect, useState } from 'react';

export default function Home() {
  const [posts, setPosts] = useState<any[]>([]);
  const [recommendation, setRecommendation] = useState<string>(''); // AI output
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('https://www.reddit.com/r/popular.json')
      .then((res) => res.json())
      .then((data) => {
        const items = data.data.children.slice(0, 5);
        setPosts(items);
      });
  }, []);

  // AI call functie
  const generateRecommendation = async () => {
    setLoading(true);
    const res = await fetch('/api/ai-recommendation');
    const data = await res.json();
    setRecommendation(data.result);
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6">👋 Welcome to Timo</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 📬 Mail Widget */}
        <div className="bg-zinc-900 p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">📬 Mail</h2>
          <p className="text-zinc-300">Your latest emails will appear here.</p>
        </div>

        {/* 🎵 Music Widget */}
        <div className="bg-zinc-900 p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">🎵 Music</h2>
          <p className="text-zinc-300">Your Spotify favorites and stats.</p>
        </div>

        {/* 💬 Reddit Widget */}
        <div className="bg-zinc-900 p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">💬 Reddit</h2>
          <ul className="space-y-2">
            {posts.map((post, i) => (
              <li key={i} className="text-sm text-zinc-300">
                <a
                  href={`https://reddit.com${post.data.permalink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline text-white"
                >
                  🔗 {post.data.title}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* 📰 AI Recommendations Widget */}
        <div className="bg-zinc-900 p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">📰 Recommendations (AI)</h2>
          <button
            onClick={generateRecommendation}
            className="mb-4 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md transition"
            disabled={loading}
          >
            {loading ? 'Thinking...' : 'Generate recommendation'}
          </button>

          <div className="text-zinc-300 text-sm whitespace-pre-line">
            {recommendation || 'Click the button to get an AI suggestion.'}
          </div>
        </div>
      </div>
    </main>
  );
}
