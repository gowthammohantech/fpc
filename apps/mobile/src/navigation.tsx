import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TouchableOpacity, Text } from 'react-native';
import { useAuth } from './lib/auth';
import { Loading } from './components/ui';
import { colors } from './lib/theme';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { ApprovalsScreen } from './screens/ApprovalsScreen';
import { ApprovalDetailScreen } from './screens/ApprovalDetailScreen';
import { PayrollScreen } from './screens/PayrollScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

export type RootStackParamList = {
  Dashboard: undefined;
  Approvals: undefined;
  ApprovalDetail: { id: string };
  Payroll: { id: string };
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function Navigation() {
  const { user, loading } = useAuth();

  if (loading) return <Loading />;

  return (
    <NavigationContainer>
      {user ? (
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.brand },
            headerTintColor: '#ffffff',
            headerTitleStyle: { fontWeight: '600' },
          }}
        >
          <Stack.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={({ navigation }) => ({
              title: 'Finance Ops',
              headerRight: () => (
                <TouchableOpacity onPress={() => navigation.navigate('Notifications')}>
                  <Text style={{ color: '#ffffff', fontWeight: '600' }}>Alerts</Text>
                </TouchableOpacity>
              ),
            })}
          />
          <Stack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: 'Approvals' }} />
          <Stack.Screen
            name="ApprovalDetail"
            component={ApprovalDetailScreen}
            options={{ title: 'Approval' }}
          />
          <Stack.Screen name="Payroll" component={PayrollScreen} options={{ title: 'Payroll' }} />
          <Stack.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{ title: 'Notifications' }}
          />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Dashboard" component={LoginScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
