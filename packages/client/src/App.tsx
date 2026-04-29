import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Routes } from './routes';
import { ToastProvider } from './components/Toast';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </QueryClientProvider>
  );
}
