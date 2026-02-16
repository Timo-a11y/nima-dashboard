'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useState } from 'react';

export default function Onepager() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isModalOpen]);

  const openModal = () => {
    setIsSubmitted(false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitted(true);
  };

  return (
    <main className="h-dvh overflow-hidden bg-slate-50 px-5 py-6 text-slate-900 sm:px-6 sm:py-8">
      <section className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
        <div className="w-full max-w-[520px] rounded-3xl bg-white p-4 shadow-[0_40px_90px_-35px_rgba(15,23,42,0.55)] sm:p-5">
          <div className="aspect-[3/2] overflow-hidden rounded-2xl border border-slate-100 bg-slate-100">
            <Image
              src="/envelope-card.svg"
              alt="Vage vorm van een envelop"
              width={1400}
              height={900}
              className="h-full w-full scale-110 object-cover blur-[2px]"
            />
          </div>
        </div>

        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500 sm:text-xs">
          Only voor de echte Fans
        </p>

        <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
          Elke maand: Twee Tieten in een envelop
        </h1>

        <p className="mt-3 text-base text-slate-600 sm:text-lg">Voor maar 5 euro per maand.</p>

        <button
          onClick={openModal}
          className="mt-6 rounded-full bg-black px-8 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-900 hover:shadow-[0_16px_35px_-16px_rgba(15,23,42,0.7)] sm:px-9 sm:py-4 sm:text-base"
        >
          Meld je nu aan
        </button>
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_35px_80px_-30px_rgba(15,23,42,0.6)] sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Aanmelding</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Start je abonnement</h2>
              </div>
              <button
                onClick={closeModal}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Sluiten
              </button>
            </div>

            {isSubmitted ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-left">
                <p className="text-sm font-medium text-slate-700">Bedankt, je aanmelding is ontvangen.</p>
                <p className="mt-2 text-sm text-slate-500">
                  Geen zorgen: dit is alleen een droge grap, er wordt niets afgeschreven.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 text-left">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Naam</span>
                  <input
                    type="text"
                    name="name"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    placeholder="Je volledige naam"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">E-mail</span>
                  <input
                    type="email"
                    name="email"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    placeholder="naam@voorbeeld.nl"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Nep-betaalmethode</span>
                  <select
                    name="payment"
                    required
                    defaultValue=""
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="" disabled>
                      Kies een methode
                    </option>
                    <option value="ideal">iDEAL (nep)</option>
                    <option value="creditcard">Creditcard (nep)</option>
                    <option value="bancontact">Bancontact (nep)</option>
                  </select>
                </label>

                <button
                  type="submit"
                  className="mt-2 w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
                >
                  Aanmelding bevestigen
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
