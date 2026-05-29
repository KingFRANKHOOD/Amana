import apiClient from './client';

export const authApi = {
  async generateChallenge(walletAddress: string) {
    const response = await apiClient.post('/auth/challenge', { walletAddress });
    return response.data;
  },

  async verifyChallenge(walletAddress: string, signedChallenge: string) {
    const response = await apiClient.post('/auth/verify', {
      walletAddress,
      signedChallenge,
    });
    return response.data;
  },

  async refreshToken() {
    const response = await apiClient.post('/auth/refresh');
    return response.data;
  },
};
