export type AffiliateAssetType = 'product' | 'storewide';

export type AffiliateAsset = {
  id: string;
  brand: 'ugee';
  type: AffiliateAssetType;
  title: string;
  description: string;
  imageUrl: string;
  trackingUrl: string;
  ctaText: string;
  weight: number;
  isActive: boolean;
};

export type PublicAffiliateAsset = Omit<AffiliateAsset, 'weight' | 'isActive'>;
