import { useReducer, useCallback } from 'react';
import type { WizardFormData, SpeciesEntry } from '../types';

export type WizardStep = 0 | 1 | 2 | 3 | 4;

interface WizardState {
  currentStep: WizardStep;
  formData: WizardFormData;
  stepErrors: Record<number, string[]>;
}

type WizardAction =
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: WizardStep }
  | { type: 'UPDATE_FIELD'; field: string; value: string }
  | { type: 'UPDATE_ENVIRONMENTAL'; field: string; value: string }
  | { type: 'SET_SPECIES'; species: SpeciesEntry[] }
  | { type: 'ADD_SPECIES'; species: SpeciesEntry }
  | { type: 'REMOVE_SPECIES'; index: number }
  | { type: 'UPDATE_SPECIES'; index: number; field: keyof SpeciesEntry; value: string | number }
  | { type: 'SET_ERRORS'; step: number; errors: string[] }
  | { type: 'RESET' };

const initialFormData: WizardFormData = {
  name: '',
  symbol: '',
  description: '',
  docsUrl: '',
  twitterUrl: '',
  coverImageUrl: '',
  environmental: {
    latitude: '',
    longitude: '',
    landAreaHectares: '',
    projectType: 'reforestation',
    species: [],
    targetNdvi: '0.65',
    baselineNdvi: '0.15',
    carbonTargetTco2Year: '',
    preFireDate: '',
  },
  totalSupply: '10000000',
  feeBps: '50',
  deployerBps: '0',
  pledgeAmount: '100000',
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'NEXT_STEP':
      return {
        ...state,
        currentStep: Math.min(4, state.currentStep + 1) as WizardStep,
      };
    case 'PREV_STEP':
      return {
        ...state,
        currentStep: Math.max(0, state.currentStep - 1) as WizardStep,
      };
    case 'GO_TO_STEP':
      return { ...state, currentStep: action.step };
    case 'UPDATE_FIELD':
      return {
        ...state,
        formData: { ...state.formData, [action.field]: action.value },
      };
    case 'UPDATE_ENVIRONMENTAL':
      return {
        ...state,
        formData: {
          ...state.formData,
          environmental: {
            ...state.formData.environmental,
            [action.field]: action.value,
          },
        },
      };
    case 'SET_SPECIES':
      return {
        ...state,
        formData: {
          ...state.formData,
          environmental: {
            ...state.formData.environmental,
            species: action.species,
          },
        },
      };
    case 'ADD_SPECIES':
      return {
        ...state,
        formData: {
          ...state.formData,
          environmental: {
            ...state.formData.environmental,
            species: [...state.formData.environmental.species, action.species],
          },
        },
      };
    case 'REMOVE_SPECIES': {
      const species = [...state.formData.environmental.species];
      species.splice(action.index, 1);
      return {
        ...state,
        formData: {
          ...state.formData,
          environmental: {
            ...state.formData.environmental,
            species,
          },
        },
      };
    }
    case 'UPDATE_SPECIES': {
      const species = [...state.formData.environmental.species];
      species[action.index] = {
        ...species[action.index],
        [action.field]: action.value,
      };
      return {
        ...state,
        formData: {
          ...state.formData,
          environmental: {
            ...state.formData.environmental,
            species,
          },
        },
      };
    }
    case 'SET_ERRORS':
      return {
        ...state,
        stepErrors: { ...state.stepErrors, [action.step]: action.errors },
      };
    case 'RESET':
      return {
        currentStep: 0,
        formData: initialFormData,
        stepErrors: {},
      };
    default:
      return state;
  }
}

export function validateStep(step: WizardStep, formData: WizardFormData, worldIdVerified: boolean, worldIdEnabled: boolean): string[] {
  const errors: string[] = [];

  switch (step) {
    case 0: // World ID
      if (worldIdEnabled && !worldIdVerified) {
        errors.push('World ID verification required');
      }
      break;
    case 1: // Project details
      if (!formData.name.trim()) errors.push('Project name is required');
      if (!formData.symbol.trim()) errors.push('Symbol is required');
      if (formData.symbol.length > 10) errors.push('Symbol must be 10 characters or less');
      if (!formData.description.trim()) errors.push('Description is required');
      break;
    case 2: // Environmental data
      if (!formData.environmental.latitude) errors.push('Latitude is required');
      if (!formData.environmental.longitude) errors.push('Longitude is required');
      if (!formData.environmental.landAreaHectares) errors.push('Land area is required');
      if (formData.environmental.species.length === 0) errors.push('At least one species is required');
      break;
    case 3: // Tokenomics
      if (!formData.totalSupply || Number(formData.totalSupply) <= 0) errors.push('Total supply must be positive');
      if (Number(formData.feeBps) > 1000) errors.push('Fee cannot exceed 10%');
      if (Number(formData.deployerBps) > 500) errors.push('Deployer allocation cannot exceed 5%');
      if (!formData.pledgeAmount || Number(formData.pledgeAmount) <= 0) errors.push('Pledge amount must be positive');
      break;
    case 4: // Review — no validation (summary only)
      break;
  }

  return errors;
}

export function useWizardState() {
  const [state, dispatch] = useReducer(wizardReducer, {
    currentStep: 0 as WizardStep,
    formData: initialFormData,
    stepErrors: {},
  });

  const nextStep = useCallback(() => dispatch({ type: 'NEXT_STEP' }), []);
  const prevStep = useCallback(() => dispatch({ type: 'PREV_STEP' }), []);
  const goToStep = useCallback((step: WizardStep) => dispatch({ type: 'GO_TO_STEP', step }), []);
  const updateField = useCallback((field: string, value: string) => dispatch({ type: 'UPDATE_FIELD', field, value }), []);
  const updateEnvironmental = useCallback((field: string, value: string) => dispatch({ type: 'UPDATE_ENVIRONMENTAL', field, value }), []);
  const setSpecies = useCallback((species: SpeciesEntry[]) => dispatch({ type: 'SET_SPECIES', species }), []);
  const addSpecies = useCallback((species: SpeciesEntry) => dispatch({ type: 'ADD_SPECIES', species }), []);
  const removeSpecies = useCallback((index: number) => dispatch({ type: 'REMOVE_SPECIES', index }), []);
  const updateSpecies = useCallback((index: number, field: keyof SpeciesEntry, value: string | number) => dispatch({ type: 'UPDATE_SPECIES', index, field, value }), []);
  const setErrors = useCallback((step: number, errors: string[]) => dispatch({ type: 'SET_ERRORS', step, errors }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    ...state,
    nextStep,
    prevStep,
    goToStep,
    updateField,
    updateEnvironmental,
    setSpecies,
    addSpecies,
    removeSpecies,
    updateSpecies,
    setErrors,
    reset,
  };
}
