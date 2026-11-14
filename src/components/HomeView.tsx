import React, { useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  MapPin,
  ShieldCheck,
  Sprout,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import heroKarlsruheUrl from '../assets/images/agrovera_karlsruhe_farmland_1794659995413.jpg';
import type { AppLanguage, FarmProfile } from '../types/domain.ts';
import {
  formatCurrency,
  formatNumber,
  formatSoilName,
} from '../utils/formatters.ts';

interface HomeViewProps {
  farm: FarmProfile;
  availableWaterM3: number;
  onSelectPlanCrop: () => void;
  onSelectProtectCrop: () => void;
  onEditFarm: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  farm,
  availableWaterM3,
  onSelectPlanCrop,
  onSelectProtectCrop,
  onEditFarm,
}) => {
  const { t, i18n } = useTranslation();
  const lang: AppLanguage = i18n.language === 'de' ? 'de' : 'en';
  const [imgFailed, setImgFailed] = useState(false);

  const soilLabel = formatSoilName(farm.soilType, lang);

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="farmer-home-view">
      {/* Compact Welcome Banner */}
      <section className="relative rounded-2xl overflow-hidden border border-stone-200/90 bg-gradient-to-br from-[#0F291E] via-[#173D2C] to-[#21503B] text-white">
        {!imgFailed && (
          <img
            src={heroKarlsruheUrl}
            alt="Agricultural fields in Germany"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-35"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B2017]/92 via-[#0F291E]/82 to-[#0F291E]/60" />

        <div className="relative z-10 px-6 py-7 sm:px-8 sm:py-9 max-w-3xl space-y-2.5">
          <p className="text-xs font-medium text-emerald-200 tracking-wide">
            {t('home.welcomeKicker')}
          </p>
          <h1
            className="text-2xl sm:text-3xl font-bold leading-tight text-white"
            style={{ textWrap: 'balance' }}
          >
            {t('home.headline')}
          </h1>
          <p className="text-sm sm:text-base text-stone-200 leading-relaxed">
            {t('home.subtitle')}
          </p>
        </div>
      </section>

      {/* Two Large, Clear Farmer Entry Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* Entry Card 1: Plan My Crop */}
        <button
          type="button"
          data-testid="home-card-plan"
          onClick={onSelectPlanCrop}
          className="group text-left bg-white hover:bg-[#F7FAF8] border border-stone-200/90 hover:border-emerald-700 rounded-2xl p-6 sm:p-8 flex flex-col justify-between transition-all shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-700"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#EEF5F1] text-[#0F291E] flex items-center justify-center group-hover:bg-[#0F291E] group-hover:text-white transition-colors">
              <CalendarClock className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
                {t('home.planTitle')}
              </h2>
              <p className="text-base font-medium text-stone-800">
                {t('home.planDesc')}
              </p>
            </div>

            <p className="text-sm text-stone-600 leading-relaxed">
              {t('home.planBullet')}
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between text-sm font-semibold text-emerald-900 group-hover:text-[#0F291E]">
            <span>{t('home.planAction')}</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </div>
        </button>

        {/* Entry Card 2: Protect My Crop */}
        <button
          type="button"
          data-testid="home-card-protect"
          onClick={onSelectProtectCrop}
          className="group text-left bg-white hover:bg-[#F7FAF8] border border-stone-200/90 hover:border-emerald-700 rounded-2xl p-6 sm:p-8 flex flex-col justify-between transition-all shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-700"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#EEF5F1] text-[#0F291E] flex items-center justify-center group-hover:bg-[#0F291E] group-hover:text-white transition-colors">
              <Sprout className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl sm:text-2xl font-bold text-[#0F291E]">
                {t('home.protectTitle')}
              </h2>
              <p className="text-base font-medium text-stone-800">
                {t('home.protectDesc')}
              </p>
            </div>

            <p className="text-sm text-stone-600 leading-relaxed">
              {t('home.protectBullet')}
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between text-sm font-semibold text-emerald-900 group-hover:text-[#0F291E]">
            <span>{t('home.protectAction')}</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </div>
        </button>
      </section>

      {/* Active Farm Summary Strip */}
      <section className="bg-white border border-stone-200/90 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex flex-wrap items-center gap-2 text-stone-700">
          <MapPin className="w-4 h-4 text-emerald-800 shrink-0" />
          <span className="font-semibold text-[#0F291E]">
            {t('home.activeFarmLabel')}
          </span>
          <span>
            {t('home.activeFarmSummary', {
              location: farm.locationName,
              area: formatNumber(farm.areaHa, lang, 1),
              soil: lang === 'de' ? soilLabel : soilLabel.toLowerCase(),
              water: formatNumber(availableWaterM3, lang, 0),
              budget: formatCurrency(farm.budgetAmount, farm.currency, lang),
            })}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-stone-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            DWD ICON · Destatis
          </span>
          <button
            type="button"
            onClick={onEditFarm}
            className="px-3.5 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-800 cursor-pointer"
          >
            {t('home.editFarmBtn')}
          </button>
        </div>
      </section>
    </div>
  );
};
