import { AppRegistry } from 'react-native';
import 'expo-router/entry';

// Holds JS timers open in the background while you are in a listening room.
// It never ends on its own: native code finishes it when the room closes
// (AudioRouteModule.setKeepAlive, driven by src/jam/session.ts).
AppRegistry.registerHeadlessTask('QuartzKeepAlive', () => () => new Promise<void>(() => {}));
