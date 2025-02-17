'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Callback() {
    const router = useRouter();

    useEffect(() => {
        // Get the code from the URL
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code) {
            // Exchange code for access token
            fetch(`/api/trakt/auth?code=${code}`)
                .then((res) => res.json())
                .then((data) => {
                    if (data.access_token) {
                        localStorage.setItem('trakt_token', data.access_token);
                        // Redirect back to the main page
                        router.push('/');
                    } else {
                        console.error('Failed to get access token:', data);
                        router.push('/?error=auth_failed');
                    }
                })
                .catch((error) => {
                    console.error('Auth error:', error);
                    router.push('/?error=auth_failed');
                });
        } else {
            router.push('/?error=no_code');
        }
    }, [router]);

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-6xl mx-auto text-center">
                <h1 className="text-2xl font-bold mb-4">Authenticating with Trakt...</h1>
                <p className="text-gray-600">Please wait while we complete the authentication process.</p>
            </div>
        </main>
    );
} 