import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

// Add token to requests
apiClient.interceptors.request.use((config) => {
  // Token would be added here from secure store if needed
  return config;
});

export default apiClient;
