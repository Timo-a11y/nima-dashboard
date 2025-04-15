// app/page.tsx
'use client';

import { useEffect, useState } from 'react';

export default function Dashboard() {
  const [recommendation, setRecommendation] = useState('');
  const [loading, setLoading] = useState(false);

  const generateRecommendation = async () => {
    setLoading(true);
    const res = await fetch('/api/ai-recommendation');
    const data = await res.json();
    setRecommendation(data.result);
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Hi Timo! 👋</p>
        </div>
        <nav className="space-x-6">
          <a href="#" className="text-gray-400 hover:text-white">Home</a>
          <a href="#" className="text-gray-400 hover:text-white">Analytics</a>
          <a href="#" className="text-gray-400 hover:text-white">Settings</a>
        </nav>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Unified Inbox */}
        <section className="bg-zinc-900 p-4 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-4">Unified Inbox</h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>📧 John Doe — Reschedule to Friday</li>
            <li>📨 Outlook — Weekly Newsletter</li>
            <li>💬 @user122 — Thanks for the info!</li>
            <li>👤 Alice — You should see this</li>
          </ul>
        </section>

        {/* Social Wall */}
        <section className="bg-zinc-900 p-4 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-4">Social Wall</h2>
          <div className="space-y-2 text-sm text-zinc-300">
            <div>@gamer42 — Just finished a new post</div>
            <div>📷 Epic sunset photo from coast</div>
            <div>🎧 Music drop preview from artist</div>
          </div>
        </section>

        {/* Community Feed */}
        <section className="bg-zinc-900 p-4 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-4">Community Feed</h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li><a href="https://www.reddit.com/r/technology" className="hover:underline text-white">Reddit: New AI tool is incredible</a></li>
            <li><a href="https://discord.com" className="hover:underline text-white">Discord: Looking forward to it!</a></li>
            <li><a href="https://www.reddit.com/r/fitness" className="hover:underline text-white">Reddit: What’s your go-to workout?</a></li>
          </ul>
        </section>

        {/* Liked Songs */}
        <section className="bg-zinc-900 p-4 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-4">Liked Songs</h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>🎵 Song One</li>
            <li>🎵 Track Two</li>
            <li>🎵 Artist Three</li>
          </ul>
        </section>

        {/* Entertainment & Music */}
        <section className="bg-zinc-900 p-4 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-4">Entertainment & Music</h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li><a href="https://www.theverge.com/tech" className="hover:underline text-white">🎧 Sordon recommends: Waner headphones</a></li>
            <li><a href="https://www.wired.com" className="hover:underline text-white">📰 Major breakthrough in tech today</a></li>
            <li><a href="https://unsplash.com/s/photos/trending" className="hover:underline text-white">📸 Trending photo: Epic Skate Tricks</a></li>
          </ul>
        </section>

        {/* Recommendations with AI */}
        <section className="bg-zinc-900 p-4 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-4">Recommendations</h2>

          <button
            onClick={generateRecommendation}
            className="mb-4 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md transition"
            disabled={loading}
          >
            {loading ? 'Thinking...' : 'Generate recommendation'}
          </button>

          <div className="text-sm text-zinc-300 whitespace-pre-line mb-4">
            {recommendation || 'Click the button to get an AI suggestion.'}
          </div>

          <div className="text-sm text-zinc-300 mb-2">🎁 Gift unlocked!</div>
          <div className="w-full bg-zinc-700 h-2 rounded">
            <div className="bg-red-500 h-2 rounded" style={{ width: '65%' }}></div>
          </div>
          <div className="mt-2 text-sm text-zinc-300">⭐ Rewards: 150 / 200 pts</div>
        </section>
      </div>
    </main>
  );
}
