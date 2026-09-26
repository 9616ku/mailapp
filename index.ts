// Must run before any module creates a TextDecoder at import time (postal-mime does).
import './src/polyfills';
import 'expo-router/entry';
