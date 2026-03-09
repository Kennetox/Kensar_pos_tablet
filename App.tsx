import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppSessionProvider, useAppSession } from './src/contexts/AppSessionContext';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppSessionProvider>
        <AppGate />
      </AppSessionProvider>
    </SafeAreaProvider>
  );
}

function AppGate() {
  const { isHydrated, isAuthenticated, syncStatus } = useAppSession();

  if (!isHydrated || (isAuthenticated && syncStatus === 'checking')) {
    return (
      <View style={styles.bootContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#07111f" />
        <ActivityIndicator size="large" color="#6ea8fe" />
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#07111f" />
      {isAuthenticated ? <HomeScreen /> : <LoginScreen />}
    </>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    backgroundColor: '#07111f',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
