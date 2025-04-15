'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [posts, setPosts] = useState<any[]>([]);

  useEffect(() => {
    fetch('https://www.reddit.com/r/popular.json')
      .then((res) => res.json())
      .then((data) => {
        const items = data.data.children.slice(0, 5);
        setPosts(items);
      });
  }, []);

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

        {/* 📰 Recommendations Widget */}
        <div className="bg-zinc-900 p-4 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-2">📰 Recommendations</h2>
          <p className="text-zinc-300">
            Shopping tips, articles, and more.
          </p>
        </div>
      </div>
    </main>
  );
}
