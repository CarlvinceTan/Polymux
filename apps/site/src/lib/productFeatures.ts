import browserImage from '../../../../docs/assets/polymux-browser-expanded.png';
import chatImage from '../../../../docs/assets/polymux-chat.png';
import driveImage from '../../../../docs/assets/polymux-drive-expanded.png';
import hubImage from '../../../../docs/assets/polymux-hub-expanded.png';
import tasksImage from '../../../../docs/assets/polymux-tasks-expanded.png';
import featureData from '../content/product/features.json';

export type ProductFeatureGroup = 'app' | 'agent';
export type ProductFeatureIcon = 'workspace' | 'hub' | 'drive' | 'browser' | 'memory' | 'tasks' | 'models' | 'skills';
export type ProductFeature = {
  group: ProductFeatureGroup;
  slug: string;
  name: string;
  icon: ProductFeatureIcon;
  menuDescription: string;
  title: string;
  description: string;
  intro: string;
  imageKey: keyof typeof featureImages | null;
  imageAlt: string;
  demoTitle?: string;
  demoItems?: Array<{label: string; title: string; description: string}>;
  benefits: Array<{title: string; description: string}>;
  steps: string[];
  example: {title: string; description: string};
  docsPath: string;
  image?: string;
};

const featureImages = {
  workspace: chatImage,
  hub: hubImage,
  drive: driveImage,
  browser: browserImage,
  tasks: tasksImage,
};

export const productFeatures: ProductFeature[] = (featureData as Omit<ProductFeature, 'image'>[]).map((feature) => ({
  ...feature,
  image: feature.imageKey ? featureImages[feature.imageKey] : undefined,
}));

export const appFeatures = productFeatures.filter((feature) => feature.group === 'app');
export const agentFeatures = productFeatures.filter((feature) => feature.group === 'agent');

export function productFeaturePath(slug: string): string {
  return `/product/${encodeURIComponent(slug)}/`;
}

export function getProductFeature(slug: string): ProductFeature | undefined {
  return productFeatures.find((feature) => feature.slug === slug);
}
