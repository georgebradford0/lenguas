import { useWindowDimensions } from 'react-native';

export function useIsTablet(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}
