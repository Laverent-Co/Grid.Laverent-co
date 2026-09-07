// RevenueCat client wiring — Test Store in Expo Go / web preview, native SDK on device builds.
// The SDK's `customerInfo.entitlements.active` is the SOLE source of truth for paid status.
// We distinguish the Pro subscription from the Walking Grid add-on by the product identifier
// carried in the active entitlement (both share the RC `pro` entitlement lookup key).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from "react-native-purchases";

import { storage } from "@/src/utils/storage";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = "pro";
// Product identifiers as returned by RC after our /setup + /products calls.
export const PRO_PACKAGE_ID = "$rc_monthly";
export const WALKING_GRID_PACKAGE_ID = "walking_grid";

export const rcEnabled = Platform.OS !== "web" || __DEV__;

const USER_ID_KEY = "cryptobot.rc_user_id";

async function getStableUserId(): Promise<string> {
  let existing = (await storage.secureGet<string>(USER_ID_KEY, "" as any)) as string | null;
  if (existing) return String(existing);
  const gen =
    typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `u-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  await storage.secureSet(USER_ID_KEY, gen);
  return gen;
}

function getRevenueCatApiKey() {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error("RevenueCat public API keys not found");
  }
  if (Platform.OS === "web" || __DEV__) return REVENUECAT_TEST_API_KEY;
  if (Platform.OS === "ios") return REVENUECAT_IOS_API_KEY;
  if (Platform.OS === "android") return REVENUECAT_ANDROID_API_KEY;
  return REVENUECAT_TEST_API_KEY;
}

export function initializeRevenueCat() {
  if (!rcEnabled) return;
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: getRevenueCatApiKey() });
}

function useSubscriptionContext() {
  const queryClient = useQueryClient();
  const identityRef = useRef<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Bind identity once per app lifecycle.
  useEffect(() => {
    if (!rcEnabled) return;
    (async () => {
      try {
        const uid = await getStableUserId();
        if (identityRef.current === uid) return;
        await Purchases.logIn(uid);
        identityRef.current = uid;
      } catch (e: any) {
        setIdentityError(String(e?.message || e));
      }
    })();
  }, []);

  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: () => Purchases.getCustomerInfo(),
    enabled: rcEnabled,
    staleTime: 60 * 1000,
  });

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    queryFn: () => Purchases.getOfferings(),
    enabled: rcEnabled,
    staleTime: 300 * 1000,
  });

  useEffect(() => {
    if (!rcEnabled) return;
    const listener = (info: CustomerInfo) =>
      queryClient.setQueryData(["revenuecat", "customer-info"], info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [queryClient]);

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: PurchasesPackage) => {
      const info = await Purchases.getCustomerInfo();
      if (info.originalAppUserId.startsWith("$RCAnonymousID:")) {
        throw new Error("identity_not_ready");
      }
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return customerInfo;
    },
  });

  const restoreMutation = useMutation({ mutationFn: () => Purchases.restorePurchases() });

  // Detect Pro vs Walking Grid via active entitlements' product identifiers.
  const active = customerInfoQuery.data?.entitlements.active ?? {};
  const activeProducts = new Set(
    Object.values(active).map((e: any) => e.productIdentifier as string),
  );
  const isPro = activeProducts.has(PRO_PACKAGE_ID);
  const hasWalkingGrid = activeProducts.has(WALKING_GRID_PACKAGE_ID);

  const offering: PurchasesOffering | null = offeringsQuery.data?.current ?? null;
  const proPackage = offering?.availablePackages.find((p) => p.identifier === PRO_PACKAGE_ID) ?? null;
  const walkingGridPackage =
    offering?.availablePackages.find((p) => p.identifier === WALKING_GRID_PACKAGE_ID) ?? null;

  const originalAppUserId = customerInfoQuery.data?.originalAppUserId;
  const identityReady = !!originalAppUserId && !originalAppUserId.startsWith("$RCAnonymousID:");

  return {
    customerInfo: customerInfoQuery.data,
    offering,
    proPackage,
    walkingGridPackage,
    isPro,
    hasWalkingGrid,
    identityReady,
    identityError,
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}
