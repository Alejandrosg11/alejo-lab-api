import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UGEE_ASSETS_CATALOG } from './ugee-assets.catalog';
import { AffiliateAsset, PublicAffiliateAsset } from './types';

@Injectable()
export class AffiliateService {
  getRandomUgeeAsset(): PublicAffiliateAsset {
    const activeAssets = UGEE_ASSETS_CATALOG.filter(
      (asset) => asset.isActive && asset.weight > 0,
    );

    if (activeAssets.length === 0) {
      throw new ServiceUnavailableException(
        'No hay assets de afiliado activos.',
      );
    }

    return this.toPublicAsset(this.pickWeightedRandom(activeAssets));
  }

  private pickWeightedRandom(assets: AffiliateAsset[]): AffiliateAsset {
    const totalWeight = assets.reduce((sum, asset) => sum + asset.weight, 0);
    let random = Math.random() * totalWeight;

    for (const asset of assets) {
      random -= asset.weight;
      if (random <= 0) {
        return asset;
      }
    }

    return assets[assets.length - 1];
  }

  private toPublicAsset(asset: AffiliateAsset): PublicAffiliateAsset {
    const { ...publicAsset } = asset;
    return publicAsset;
  }
}
