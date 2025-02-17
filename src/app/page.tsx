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

const StarRating = ({ rating }: { rating: number | null }) => {
  if (rating === null) return <span className="text-gray-500">Not rated</span>;

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - Math.ceil(rating);

  return (
    <div className="flex items-center gap-0.5 text-xl">
      {[...Array(fullStars)].map((_, i) => (
        <span key={`full-${i}`} className="text-green-500">★</span>
      ))}
      {hasHalfStar && <span className="text-green-500">½</span>}
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
        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-violet-600 focus:ring-violet-500"
      />
    </div>
  ),
  cell: ({ row }) => (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-violet-600 focus:ring-violet-500"
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
        <div className="overflow-auto" style={{ maxHeight: maxHeight }}>
          <table className="min-w-full divide-y divide-gray-800">
            <thead className="bg-gray-800 sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      style={{ width: header.column.getSize() }}
                      className={`px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap ${header.column.getCanSort() ? 'cursor-pointer select-none' : ''
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
                        maxWidth: cell.column.getSize(),
                      }}
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-300 overflow-hidden text-ellipsis"
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
  return {
    movie: data.movie,
    alreadyExists: data.alreadyExists,
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

  // Split movies into three categories
  const uncheckedMovies = movies.filter(m => m.syncError === 'Unchecked');
  const existingMovies = movies.filter(m => m.synced || m.syncError === 'Already in Trakt');
  const newMovies = movies.filter(m => !m.synced && m.syncError !== 'Already in Trakt' && m.syncError !== 'Unchecked');

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

    // Check if we have a stored token
    const token = localStorage.getItem('trakt_token');
    if (token) {
      setIsAuthenticated(true);
    }
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
            if (updatedMovies[j].syncError === 'Unchecked') {
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
        if (movie.syncError !== 'Unchecked' && movie.syncError !== 'Failed to check history') {
          continue;
        }

        try {
          const result = await checkMovieInTraktHistory(movie);
          updatedMovies[i] = {
            ...movie,
            syncError: result.alreadyExists ? 'Already in Trakt' : 'Ready to sync',
            traktWatchedDate: result.watchedAt,
            synced: result.alreadyExists
          };
          setMovies([...updatedMovies]);
        } catch (error) {
          console.error('Error checking movie history:', error);
          updatedMovies[i] = {
            ...movie,
            syncError: error instanceof Error ? error.message : 'Failed to check history',
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
      localStorage.removeItem('lb_movies');
      localStorage.removeItem('lb_selection');
    }
  }, [setMovies, setNewMoviesSelection, setExistingMoviesSelection, setIsSyncCancelled]);

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

      for (let i = 0; i < selectedMovies.length; i++) {
        if (isSyncCancelled) {
          break;
        }

        const movie = selectedMovies[i];
        if (movie.synced) {
          continue;
        }

        try {
          const result = await syncMovieToTrakt({
            Name: movie.name,
            Year: movie.year,
            Rating: movie.letterboxdRating?.toString() || '',
            Date: movie.watchedDate || '',
          });

          setMovies((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((m) => m.id === movie.id);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                synced: true,
                syncError: result.alreadyExists ? 'Already in Trakt' : undefined,
                traktWatchedDate: movie.watchedDate,
              };
            }
            return updated;
          });
        } catch (error) {
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
    } finally {
      setIsProcessing(false);
      setIsSyncCancelled(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gray-900 text-gray-100">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Letterboxd to Trakt Sync</h1>

        {authError && (
          <div className="mb-4 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg">
            {authError}
          </div>
        )}

        {!isAuthenticated ? (
          <button
            onClick={handleAuth}
            className="mb-8 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700"
          >
            Connect to Trakt
          </button>
        ) : (
          <>
            {movies.length === 0 ? (
              <div className="mb-4">
                <p className="text-gray-300 mb-2">
                  First, download your Letterboxd data from{' '}
                  <a
                    href="https://letterboxd.com/settings/data/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 underline"
                  >
                    letterboxd.com/settings/data
                  </a>
                </p>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 transition-colors ${isDragging
                    ? 'border-violet-500 bg-violet-900/20'
                    : 'border-gray-700 hover:border-violet-600'
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
                      className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-900/50 file:text-violet-300 hover:file:bg-violet-800/50"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {uncheckedMovies.length > 0 && (
                  <>
                    <div className="mb-4 p-4 bg-yellow-900/50 border border-yellow-700 text-yellow-200 rounded-lg flex items-center justify-between">
                      <div>
                        {uncheckedMovies.length} movies need to be checked against Trakt.

                        This may take a while if you have a lot of movies.
                      </div>
                      <button
                        onClick={isCheckingHistory ? () => setIsCheckingHistory(false) : checkHistory}
                        className={`px-4 py-2 rounded-lg ${isCheckingHistory
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-yellow-700 hover:bg-yellow-600 disabled:bg-yellow-800'
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
                    <div className="mb-4 p-4 bg-violet-900/50 border border-violet-700 text-violet-200 rounded-lg">
                      <p>
                        Select the movies you want to sync to Trakt. Selected movies will be added to your Trakt history with their watched dates and ratings.
                      </p>
                      <div className="flex gap-4 mt-4">
                        {isCheckingHistory ? (
                          <div className="flex items-center gap-4">
                            <div className="bg-violet-600/20 text-violet-300 px-4 py-2 rounded-lg flex items-center gap-2">
                              <svg className="animate-spin h-5 w-5 text-violet-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Checking Trakt for Letterboxd history...
                            </div>
                          </div>
                        ) : isProcessing ? (
                          <>
                            <button
                              onClick={handleCancelSync}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
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
                                uncheckedMovies.length > 0 ||
                                !Object.values(newMoviesSelection).some(selected => selected)
                              }
                              className="bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 disabled:bg-gray-700"
                            >
                              Sync {Object.values(newMoviesSelection).filter(selected => selected).length} Movies to Trakt
                            </button>
                            <button
                              onClick={handleClearData}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
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
