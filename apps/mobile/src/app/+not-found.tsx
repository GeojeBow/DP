import { Redirect } from 'expo-router';

/** Unknown paths (including when the web build is opened from a sub-path) land on home. */
export default function NotFound() {
  return <Redirect href="/" />;
}
