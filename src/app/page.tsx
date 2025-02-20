'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { parse } from 'papaparse';
import JSZip from 'jszip';
import {
  createColumnHelper,
  useReactTable,
  getCoreRowModel,
  flexRender,
  getSortedRowModel,
  SortingState,
  OnChangeFn,
} from '@tanstack/react-table';
import { LetterboxdEntry, MovieStatus } from '@/types';
import { initTraktClient, syncMovieToTrakt } from '@/utils/trakt';
import { useAtom } from 'jotai';
import { moviesAtom, isCheckingHistoryAtom, newMoviesSelectionAtom, existingMoviesSelectionAtom } from '@/atoms';
import confetti from 'canvas-confetti';

const StarRating = ({ rating }: { rating: number | null }) => {
  if (rating === null) return <span className="text-gray-500">Not rated</span>;

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - Math.ceil(rating);

  return (
    <div className="flex items-center gap-0.5 text-xl">
      {[...Array(fullStars)].map((_, i) => (
        <span key={`full-${i}`} className="text-[#00e054]">★</span>
      ))}
      {hasHalfStar && <span className="text-[#00e054] text-sm relative top-[1px]">½</span>}
      {[...Array(emptyStars)].map((_, i) => (
        <span key={`empty-${i}`} className="text-gray-600">★</span>
      ))}
    </div>
  );
};

const HeartRating = ({ rating }: { rating: number | null }) => {
  if (rating === null) return <span className="text-gray-500">Not rated</span>;

  const fullHearts = Math.floor(rating);
  const emptyHearts = 10 - fullHearts;

  return (
    <div className="flex items-center gap-0.5 flex-wrap text-base">
      {[...Array(fullHearts)].map((_, i) => (
        <span key={`full-${i}`} className="text-red-500">♥</span>
      ))}
      {[...Array(emptyHearts)].map((_, i) => (
        <span key={`empty-${i}`} className="text-gray-600">♥</span>
      ))}
    </div>
  );
};

const columnHelper = createColumnHelper<MovieStatus>();

const checkboxColumn = columnHelper.accessor('selected', {
  header: ({ table }) => (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={table.getIsAllRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-[#9447bf] focus:ring-[#9447bf]"
      />
    </div>
  ),
  cell: ({ row }) => (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-[#9447bf] focus:ring-[#9447bf]"
      />
    </div>
  ),
  size: 40,
  enableSorting: true,
});

const baseColumns = [
  columnHelper.accessor('name', {
    header: 'Movie Name',
    cell: (info) => info.getValue(),
    size: 200,
  }),
  columnHelper.accessor('synced', {
    header: 'Status',
    cell: (info) => {
      if (info.row.original.syncError === 'Unchecked') {
        return '⏳ Waiting to check';
      }
      return info.getValue()
        ? '✅ Synced'
        : info.row.original.syncError === 'Ready to sync'
          ? '⏳ Ready to sync'
          : info.row.original.syncError
            ? `❌ ${info.row.original.syncError}`
            : '⏳ Pending';
    },
    size: 140,
  }),
  columnHelper.accessor('letterboxdRating', {
    header: 'Letterboxd',
    cell: (info) => <StarRating rating={info.getValue()} />,
    size: 120,
  }),
  columnHelper.accessor('watchedDate', {
    header: 'Watched Date',
    cell: (info) => info.getValue() || 'No date',
    sortingFn: 'datetime',
    size: 80,
  }),
];

const existingMoviesColumns = [
  columnHelper.accessor('name', {
    header: 'Movie Name',
    cell: (info) => info.getValue(),
    size: 200,
  }),
  columnHelper.accessor('synced', {
    header: 'Status',
    cell: (info) => info.getValue() ? '✅ Synced' : '❌ Error',
    size: 120,
  }),
  columnHelper.accessor('letterboxdRating', {
    header: 'Letterboxd',
    cell: (info) => <StarRating rating={info.getValue()} />,
    size: 120,
  }),
  columnHelper.accessor('traktRating', {
    header: 'Trakt',
    cell: (info) => {
      const letterboxdRating = info.row.original.letterboxdRating;
      if (letterboxdRating === null) return <span className="text-gray-500">Not rated</span>;
      // Convert Letterboxd 0-5 scale to Trakt 1-10 scale
      const traktRating = Math.round(letterboxdRating * 2);
      return <HeartRating rating={traktRating} />;
    },
    size: 150,
  }),
  columnHelper.accessor('watchedDate', {
    header: 'Letterboxd Date',
    cell: (info) => info.getValue() || 'No date',
    sortingFn: 'datetime',
    size: 100,
  }),
  columnHelper.accessor('traktWatchedDate', {
    header: 'Trakt Date',
    cell: (info) => {
      const date = info.row.original.traktWatchedDate;
      if (!date) return 'No date';
      return date.split('T')[0]; // This will show just the YYYY-MM-DD part
    },
    sortingFn: 'datetime',
    size: 100,
  }),
];

const columnsWithCheckbox = [checkboxColumn, ...baseColumns];

const MovieTable = ({
  movies,
  title,
  rowSelection,
  onRowSelectionChange,
  sorting,
  onSortingChange,
  maxHeight,
  showCheckbox = true,
  isExistingMovies = false,
}: {
  movies: MovieStatus[];
  title: string;
  rowSelection: Record<string, boolean>;
  onRowSelectionChange: OnChangeFn<Record<string, boolean>>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  maxHeight?: string;
  showCheckbox?: boolean;
  isExistingMovies?: boolean;
}) => {
  const table = useReactTable({
    data: movies,
    columns: isExistingMovies ? existingMoviesColumns : (showCheckbox ? columnsWithCheckbox : baseColumns),
    state: {
      sorting,
      rowSelection,
    },
    enableRowSelection: showCheckbox,
    onRowSelectionChange,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">{title} ({movies.length})</h2>
      <div className="border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: maxHeight }}>
          <table className="min-w-full divide-y divide-gray-800">
            <thead className="bg-gray-800 sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      style={{ width: header.column.getSize(), minWidth: header.column.getSize() }}
                      className={`px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap ${header.column.getCanSort() ? 'cursor-pointer select-none' : ''
                        }`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-2">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                          asc: ' 🔼',
                          desc: ' 🔽',
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="bg-gray-900 divide-y divide-gray-800">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        width: cell.column.getSize(),
                        minWidth: cell.column.getSize(),
                        maxWidth: cell.column.getSize(),
                      }}
                      className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-300 overflow-hidden text-ellipsis"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

type TraktMovie = {
  title: string;
  year: number;
  ids: {
    trakt: number;
    slug: string;
    imdb: string;
    tmdb: number;
  };
  watched_at?: string;
};

async function checkMovieInTraktHistory(movie: MovieStatus): Promise<{ movie: TraktMovie; alreadyExists: boolean; watchedAt: string | null }> {
  const token = localStorage.getItem('trakt_token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(
    `/api/trakt/history?name=${encodeURIComponent(movie.name)}&year=${movie.year}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (response.status === 404) {
    // Movie not found in Trakt, which is fine - it's just a new movie
    return {
      movie: {
        title: movie.name,
        year: parseInt(movie.year),
        ids: { trakt: 0, slug: '', imdb: '', tmdb: 0 },
      },
      alreadyExists: false,
      watchedAt: null,
    };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to check movie history');
  }

  const data = await response.json();
  const movieWatchDate = movie.watchedDate ? new Date(movie.watchedDate).toISOString().split('T')[0] : null;
  const traktWatchDate = data.movie?.watched_at ? new Date(data.movie.watched_at).toISOString().split('T')[0] : null;

  // Consider it a rewatch if the dates are different
  const isRewatch = movieWatchDate && traktWatchDate && movieWatchDate !== traktWatchDate;

  return {
    movie: data.movie,
    alreadyExists: data.alreadyExists && !isRewatch,
    watchedAt: data.movie?.watched_at || null,
  };
}

export default function Home() {
  const [movies, setMovies] = useAtom(moviesAtom);
  const [isCheckingHistory, setIsCheckingHistory] = useAtom(isCheckingHistoryAtom);
  const [newMoviesSelection, setNewMoviesSelection] = useAtom(newMoviesSelectionAtom);
  const [existingMoviesSelection, setExistingMoviesSelection] = useAtom(existingMoviesSelectionAtom);
  const isCancelled = useRef(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSyncCancelled, setIsSyncCancelled] = useState(false);

  // Separate sorting states for each table
  const [newMoviesSorting, setNewMoviesSorting] = useState<SortingState>([
    { id: 'watchedDate', desc: true },
  ]);
  const [existingMoviesSorting, setExistingMoviesSorting] = useState<SortingState>([
    { id: 'watchedDate', desc: true },
  ]);

  const [userProfile, setUserProfile] = useState<{ username: string; name: string; avatar?: string } | null>(null);

  // Split movies into three categories
  const uncheckedMovies = movies.filter(m => m.syncError === 'Unchecked' || m.syncError?.startsWith('Failed'));
  const existingMovies = movies.filter(m => m.synced || m.syncError === 'Already in Trakt');
  const newMovies = movies.filter(m =>
    !m.synced &&
    m.syncError !== 'Already in Trakt' &&
    m.syncError !== 'Unchecked' &&
    !m.syncError?.startsWith('Failed') &&
    !existingMovies.some(em => em.id === m.id)
  );

  const handleLogout = useCallback(() => {
    localStorage.removeItem('trakt_token');
    setIsAuthenticated(false);
    setUserProfile(null);
  }, []);

  const handleAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_TRAKT_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      alert('Missing Trakt configuration');
      return;
    }

    const authUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`;
    window.location.href = authUrl;
  };

  useEffect(() => {
    // Check for error parameter
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      setAuthError(error === 'auth_failed'
        ? 'Authentication failed. Please try again.'
        : 'An error occurred during authentication.');
      // Clean up URL
      window.history.replaceState({}, document.title, '/');
    }

    // Check if we have a stored token and fetch user profile
    const token = localStorage.getItem('trakt_token');
    if (token) {
      setIsAuthenticated(true);
      // Fetch user profile
      fetch('/api/trakt/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
        .then(response => {
          if (!response.ok) throw new Error('Failed to fetch user profile');
          return response.json();
        })
        .then(data => {
          if (data.user) {
            setUserProfile({
              username: data.user.username,
              name: data.user.name || data.user.username,
              avatar: data.user.images?.avatar?.full,
            });
          } else {
            throw new Error('Invalid user data');
          }
        })
        .catch(error => {
          console.error('Error fetching user profile:', error);
          handleLogout();
        });
    }
  }, [handleLogout]);

  const checkHistory = useCallback(async () => {
    if (isCheckingHistory) return;
    setIsCheckingHistory(true);
    isCancelled.current = false;

    try {
      const updatedMovies = [...movies];
      for (let i = 0; i < updatedMovies.length; i++) {
        if (isCancelled.current) {
          // If cancelled, preserve the state of unchecked movies
          for (let j = i; j < updatedMovies.length; j++) {
            if (updatedMovies[j].syncError === 'Unchecked' || updatedMovies[j].syncError?.startsWith('Failed')) {
              updatedMovies[j] = {
                ...updatedMovies[j],
                syncError: 'Unchecked'
              };
            }
          }
          setMovies([...updatedMovies]);
          break;
        }

        const movie = updatedMovies[i];
        // Skip movies that have already been checked successfully
        if (movie.syncError !== 'Unchecked' && !movie.syncError?.startsWith('Failed')) {
          continue;
        }

        try {
          const result = await checkMovieInTraktHistory(movie);
          updatedMovies[i] = {
            ...movie,
            syncError: result.alreadyExists ? 'Already in Trakt' : 'Ready to sync',
            traktWatchedDate: result.watchedAt,
            synced: result.alreadyExists && movie.watchedDate === result.watchedAt?.split('T')[0]
          };
          setMovies([...updatedMovies]);
        } catch (error) {
          console.error('Error checking movie history:', error);
          // Keep the movie in unchecked state instead of marking it as failed
          updatedMovies[i] = {
            ...movie,
            syncError: 'Unchecked',
            synced: false
          };
          setMovies([...updatedMovies]);
        }
      }
    } finally {
      setIsCheckingHistory(false);
      isCancelled.current = false;
    }
  }, [movies, isCheckingHistory, setIsCheckingHistory, setMovies]);

  const processCSV = useCallback((csvData: string) => {
    parse(csvData, {
      header: true,
      complete: async (results) => {
        const entries = results.data as LetterboxdEntry[];
        const movieStatuses: MovieStatus[] = entries.map((entry) => ({
          id: `${entry.Name}-${entry.Year}`,
          name: entry.Name,
          year: entry.Year,
          letterboxdRating: entry.Rating ? parseFloat(entry.Rating) : null,
          traktRating: null,
          watchedDate: entry.WatchedDate || entry.Date || null,
          traktWatchedDate: null,
          synced: false,
          selected: true,
          syncError: 'Unchecked',
        }));

        setMovies(movieStatuses);
        const initialSelection = movieStatuses.reduce((acc, movie, index) => {
          acc[index] = true;
          return acc;
        }, {} as Record<string, boolean>);
        setNewMoviesSelection(initialSelection);
      },
    });
  }, [setMovies, setNewMoviesSelection]);

  const handleFile = useCallback(async (file: File) => {
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      processCSV(text);
    } else if (file.name.endsWith('.zip')) {
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);
      const diaryFile = contents.file('diary.csv');

      if (diaryFile) {
        const csvData = await diaryFile.async('string');
        processCSV(csvData);
      } else {
        alert('Could not find diary.csv in the zip file');
      }
    }
  }, [processCSV]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleClearData = useCallback(() => {
    if (window.confirm('Are you sure you want to clear all data? This will remove all movies and progress.')) {
      setMovies([]);
      setNewMoviesSelection({});
      setExistingMoviesSelection({});
      setIsSyncCancelled(false);
    }
  }, [setMovies, setNewMoviesSelection, setExistingMoviesSelection]);

  const handleCancelSync = useCallback(() => {
    setIsSyncCancelled(true);
  }, []);

  const handleSync = async () => {
    const token = localStorage.getItem('trakt_token');
    if (!token) {
      alert('Please authenticate with Trakt first');
      return;
    }

    try {
      setIsProcessing(true);
      setIsSyncCancelled(false);

      initTraktClient({
        client_id: process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
        client_secret: '',
        redirect_uri: process.env.NEXT_PUBLIC_TRAKT_REDIRECT_URI!,
        access_token: token,
      });

      // Combine selections from both tables
      const selectedMovies = [
        ...newMovies.filter((_, index) => newMoviesSelection[index]),
        ...existingMovies.filter((_, index) => existingMoviesSelection[index]),
      ];

      console.log('Starting sync with selected movies:', selectedMovies.map(m => ({
        name: m.name,
        synced: m.synced,
        syncError: m.syncError,
        id: m.id
      })));

      let successCount = 0;
      for (let i = 0; i < selectedMovies.length; i++) {
        if (isSyncCancelled) {
          console.log('Sync cancelled');
          break;
        }

        const movie = selectedMovies[i];
        console.log(`Processing movie ${i + 1}/${selectedMovies.length}:`, {
          name: movie.name,
          synced: movie.synced,
          syncError: movie.syncError,
          id: movie.id
        });

        if (movie.synced) {
          console.log('Skipping already synced movie:', movie.name);
          continue;
        }

        try {
          console.log('Attempting to sync:', movie.name);
          const result = await syncMovieToTrakt({
            Name: movie.name,
            Year: movie.year,
            Rating: movie.letterboxdRating?.toString() || '',
            Date: movie.watchedDate || '',
          });

          console.log('Sync result for', movie.name, ':', result);

          setMovies((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((m) => m.id === movie.id);
            console.log('Updating movie at index:', index, 'with ID:', movie.id);
            if (index !== -1) {
              const updatedMovie = {
                ...updated[index],
                synced: true,
                syncError: result.alreadyExists ? 'Already in Trakt' : undefined,
                traktWatchedDate: movie.watchedDate,
              };
              console.log('Updated movie state:', updatedMovie);
              updated[index] = updatedMovie;
            } else {
              console.warn('Could not find movie in state with ID:', movie.id);
            }
            return updated;
          });
          successCount++;
          console.log('Success count:', successCount);
        } catch (error) {
          console.error('Error syncing movie:', movie.name, error);
          setMovies((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((m) => m.id === movie.id);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                syncError: error instanceof Error ? error.message : 'Unknown error',
              };
            }
            return updated;
          });
        }
      }

      console.log('Sync complete. Final stats:', {
        successCount,
        totalSelected: selectedMovies.length,
        wasCancelled: isSyncCancelled
      });

      // If all selected movies were synced successfully and we didn't cancel, trigger confetti
      if (successCount === selectedMovies.length && !isSyncCancelled) {
        const duration = 3000;
        const end = Date.now() + duration;

        // Fire initial bursts
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#9447bf', '#66dd66', '#dcc5ea']
        });

        const frame = () => {
          confetti({
            particleCount: 4,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.8 },
            colors: ['#9447bf', '#66dd66', '#dcc5ea'],
            gravity: 0.8,
            scalar: 1.2
          });
          confetti({
            particleCount: 4,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.8 },
            colors: ['#9447bf', '#66dd66', '#dcc5ea'],
            gravity: 0.8,
            scalar: 1.2
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        };
        frame();
      }

    } finally {
      setIsProcessing(false);
      setIsSyncCancelled(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gray-900 text-gray-100">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center sm:text-left">Letterboxd to Trakt Sync</h1>

        <div className="prose prose-invert mb-8 max-w-full">
          <p className="font-bold mb-4 text-gray-300">
            Welcome! This site helps you sync your <a href="https://letterboxd.com" target="_blank" rel="noopener noreferrer" className="text-[#66dd66] hover:text-[#66dd66]">Letterboxd</a> watched history to <a href="https://trakt.tv" target="_blank" rel="noopener noreferrer" className="text-[#9447bf] hover:text-[#8040aa]">Trakt.tv</a>. Here&apos;s how it works:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-gray-300" id="instructions">
            <li className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                {!isAuthenticated ? (
                  <>Click the button below to connect your <a href="https://trakt.tv" target="_blank" rel="noopener noreferrer" className="text-[#9447bf] hover:text-[#8040aa]">Trakt.tv</a></>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full bg-[#9447bf]/10 px-3 py-1.5 rounded-lg border border-[#9447bf]/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-2 sm:mb-0">
                      <img src="trakt-logo.svg" alt="Trakt" className="h-5" />
                      {userProfile ? (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                          {userProfile.avatar && (
                            <img
                              src={userProfile.avatar}
                              alt={userProfile.username}
                              className="w-6 h-6 rounded-full"
                            />
                          )}
                          <span className="text-[#dcc5ea]">{userProfile.username}</span>
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={`https://trakt.tv/users/${userProfile.username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs bg-[#9447bf]/20 text-[#dcc5ea] px-2 py-1 rounded hover:bg-[#9447bf]/30 transition-colors"
                            >
                              Profile
                              <svg
                                className="inline-block w-3 h-3 ml-1"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                              </svg>
                            </a>
                            <a
                              href={`https://trakt.tv/users/${userProfile.username}/history`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs bg-[#9447bf]/20 text-[#dcc5ea] px-2 py-1 rounded hover:bg-[#9447bf]/30 transition-colors"
                            >
                              History
                              <svg
                                className="inline-block w-3 h-3 ml-1"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                              </svg>
                            </a>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#dcc5ea]">Loading...</span>
                      )}
                    </div>
                    <button
                      onClick={handleLogout}
                      className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 w-full sm:w-auto"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </li>
            <li>
              <a
                href="https://letterboxd.com/settings/data/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#66dd66] hover:text-[#66dd66] underline"
              >
                Download your Letterboxd data
              </a>
              {' '}(you&apos;ll receive a ZIP file)</li>
            <li>Upload your Letterboxd export file here</li>
            {movies.length > 0 && (
              <>
                <li>Run the check to see if any movies are already in your Trakt history</li>
                <li>Review and select which movies you want to sync</li>
                <li>Click sync and watch your Letterboxd history appear in Trakt!</li>
              </>
            )}
          </ol>
        </div>

        {authError && (
          <div className="mb-4 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg">
            {authError}
          </div>
        )}

        {!isAuthenticated ? (
          <div>
            <button
              onClick={handleAuth}
              className="bg-[#9447bf] text-black px-6 py-3 rounded-lg hover:bg-[#8040aa] flex items-center gap-2 text-lg"
            >
              Login with <img src="trakt-with-logo.svg" alt="Trakt" className="h-6" />
            </button>
          </div>
        ) : (
          <>
            {movies.length === 0 ? (
              <div className="mb-4">
                <div
                  className={`border-2 border-dashed rounded-lg p-8 transition-colors ${isDragging
                    ? 'border-[#9447bf] bg-[#9447bf]/20'
                    : 'border-gray-700 hover:border-[#9447bf]'
                    }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="text-center">
                    <p className="text-gray-300 mb-4">
                      Drag and drop your Letterboxd export zip file or diary.csv here
                    </p>
                    <p className="text-gray-400 text-sm mb-4">- or -</p>
                    <input
                      type="file"
                      accept=".csv,.zip"
                      onChange={handleFileUpload}
                      className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#9447bf]/50 file:text-[#9447bf] hover:file:bg-[#9447bf]/80"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {uncheckedMovies.length > 0 && (
                  <>
                    <div className="mb-4 p-4 bg-[#9447bf]/20 border border-[#9447bf] text-[#dcc5ea] rounded-lg flex items-center justify-between">
                      <div>
                        {uncheckedMovies.length} movies need to be checked against Trakt.
                        <br />
                        {uncheckedMovies.length > 100 && 'This will take a while if you have a lot of movies.'}
                      </div>
                      <button
                        onClick={isCheckingHistory ? () => setIsCheckingHistory(false) : checkHistory}
                        className={`px-4 py-2 rounded-lg ${isCheckingHistory
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-[#9447bf] hover:bg-[#8040aa] disabled:bg-gray-700'
                          } text-white`}
                      >
                        {isCheckingHistory ? 'Stop Checking' : 'Check Movies'}
                      </button>
                    </div>
                    <MovieTable
                      movies={uncheckedMovies}
                      title="Unchecked Movies"
                      rowSelection={{}}
                      onRowSelectionChange={() => { }}
                      sorting={newMoviesSorting}
                      onSortingChange={setNewMoviesSorting}
                      maxHeight="500px"
                      showCheckbox={false}
                    />
                  </>
                )}

                {newMovies.length > 0 && (
                  <>
                    <div className="mb-4 p-4 bg-[#9447bf]/20 border border-[#9447bf] text-[#dcc5ea] rounded-lg">
                      <p>
                        Select the movies you want to sync to Trakt. Selected movies will be added to your Trakt history with their watched dates and ratings.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-4 mt-4">
                        {isCheckingHistory ? (
                          <div className="flex items-center gap-4">
                            <div className="bg-[#9447bf]/20 text-[#dcc5ea] px-4 py-2 rounded-lg flex items-center gap-2 w-full sm:w-auto">
                              <svg className="animate-spin h-5 w-5 text-[#dcc5ea]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Checking Trakt for Letterboxd history...
                            </div>
                          </div>
                        ) : isProcessing ? (
                          <>
                            <button
                              disabled
                              className="bg-[#9447bf] text-white px-4 py-2 rounded-lg opacity-75 flex items-center gap-2 w-full sm:w-auto justify-center"
                            >
                              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Syncing...
                            </button>
                            <button
                              onClick={handleCancelSync}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 w-full sm:w-auto"
                            >
                              Cancel Sync
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={handleSync}
                              disabled={
                                isProcessing ||
                                newMovies.filter((movie, index) =>
                                  newMoviesSelection[index] &&
                                  movie.syncError !== 'Already in Trakt'
                                ).length === 0
                              }
                              className="bg-[#9447bf] text-white px-4 py-2 rounded-lg hover:bg-[#8040aa] disabled:bg-gray-700 w-full sm:w-auto"
                            >
                              Sync {newMovies.filter((_, index) => newMoviesSelection[index]).length} Movies to Trakt
                            </button>
                            <button
                              onClick={handleClearData}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 w-full sm:w-auto"
                            >
                              Clear Data
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <MovieTable
                      movies={newMovies}
                      title="New Movies"
                      rowSelection={newMoviesSelection}
                      onRowSelectionChange={setNewMoviesSelection}
                      sorting={newMoviesSorting}
                      onSortingChange={setNewMoviesSorting}
                      maxHeight="500px"
                      showCheckbox={true}
                      isExistingMovies={false}
                    />
                  </>
                )}

                {existingMovies.length > 0 && (
                  <MovieTable
                    movies={existingMovies}
                    title="Already in Trakt"
                    rowSelection={{}}
                    onRowSelectionChange={() => { }}
                    sorting={existingMoviesSorting}
                    onSortingChange={setExistingMoviesSorting}
                    maxHeight="500px"
                    showCheckbox={false}
                    isExistingMovies={true}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
