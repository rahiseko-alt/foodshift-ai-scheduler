import { ShiftOptimizeRequest, ShiftOptimizeResponse } from './types';
import { DEMO_IZAKAYA_DATA } from './mock-data';

const STORAGE_KEY_REQUEST = 'foodshift_request_data';
const STORAGE_KEY_RESPONSE = 'foodshift_last_response';

export function loadSavedRequest(): ShiftOptimizeRequest {
  if (typeof window === 'undefined') return DEMO_IZAKAYA_DATA;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_REQUEST);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load request from localStorage', e);
  }
  return DEMO_IZAKAYA_DATA;
}

export function saveRequest(data: ShiftOptimizeRequest): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_REQUEST, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save request to localStorage', e);
  }
}

export function loadSavedResponse(): ShiftOptimizeResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_RESPONSE);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load response from localStorage', e);
  }
  return null;
}

export function saveResponse(data: ShiftOptimizeResponse): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_RESPONSE, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save response to localStorage', e);
  }
}
