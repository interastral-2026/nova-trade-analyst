
import React from 'react';

const StrategyInfo: React.FC = () => {
  return (
    <div className="space-y-6 text-slate-300 font-sans p-2">
      <section className="bg-indigo-500/5 border border-indigo-500/20 rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <i className="fas fa-brain text-6xl text-indigo-400"></i>
        </div>
        <h3 className="text-xl font-black text-white mb-4 flex items-center space-x-3">
          <span className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm">
            <i className="fas fa-ghost"></i>
          </span>
          <span>استراتژی ربات Ghost SMC</span>
        </h3>
        <p className="text-sm leading-relaxed mb-4 text-slate-400" dir="rtl">
          این ربات از مفاهیم **Smart Money Concepts (SMC)** برای شناسایی فرصت‌های معاملاتی با احتمال برد بالا استفاده می‌کند. هدف اصلی حفظ سرمایه و شکار حرکت‌های بزرگ بازار است.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
            <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2 flex items-center space-x-2">
              <i className="fas fa-search-dollar text-[10px]"></i>
              <span>نحوه شناسایی موقعیت</span>
            </h4>
            <ul className="text-[11px] space-y-2 text-slate-400 list-disc list-inside" dir="rtl">
              <li>شناسایی **Liquidity Sweeps** (جمع‌آوری نقدینگی)</li>
              <li>تشخیص **Market Structure Shift (MSS)** برای تغییر روند</li>
              <li>یافتن **FVG (Fair Value Gaps)** برای نقاط ورود بهینه</li>
              <li>استفاده از **Order Blocks** به عنوان نواحی حمایت و مقاومت هوشمند</li>
            </ul>
          </div>
          
          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
            <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center space-x-2">
              <i className="fas fa-shield-alt text-[10px]"></i>
              <span>مدیریت ریسک هوشمند</span>
            </h4>
            <ul className="text-[11px] space-y-2 text-slate-400 list-disc list-inside" dir="rtl">
              <li>محاسبه دقیق کارمزدها (1.2% برای هر معامله رفت و برگشت)</li>
              <li>شرط ورود: حداقل **1.0% سود خالص** پس از کسر تمام هزینه‌ها</li>
              <li>**Trailing Stop** خودکار برای حفظ سودهای به دست آمده</li>
              <li>خروج سریع در صورت تغییر ساختار بازار یا کاهش قدرت روند</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#080812] border border-white/5 p-5 rounded-3xl text-center">
          <div className="w-10 h-10 bg-cyan-500/10 text-cyan-400 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className="fas fa-microchip"></i>
          </div>
          <h5 className="text-[10px] font-black text-white uppercase mb-1">هسته پردازشی</h5>
          <p className="text-[9px] text-slate-500 uppercase font-bold">gemini-3.1-flash-lite-preview</p>
        </div>
        
        <div className="bg-[#080812] border border-white/5 p-5 rounded-3xl text-center">
          <div className="w-10 h-10 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className="fas fa-clock"></i>
          </div>
          <h5 className="text-[10px] font-black text-white uppercase mb-1">تایم‌فریم تحلیل</h5>
          <p className="text-[9px] text-slate-500 uppercase font-bold">15 Minute Candles</p>
        </div>

        <div className="bg-[#080812] border border-white/5 p-5 rounded-3xl text-center">
          <div className="w-10 h-10 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className="fas fa-bolt"></i>
          </div>
          <h5 className="text-[10px] font-black text-white uppercase mb-1">سرعت واکنش</h5>
          <p className="text-[9px] text-slate-500 uppercase font-bold">Real-time Monitoring</p>
        </div>
      </section>

      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6">
        <h4 className="text-sm font-black text-white mb-4 flex items-center space-x-2">
          <i className="fas fa-info-circle text-indigo-500"></i>
          <span>ربات الان چه کار می‌کند؟</span>
        </h4>
        <div className="space-y-4 text-[11px] text-slate-400 leading-relaxed" dir="rtl">
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>ربات به صورت مداوم لیست ارزهای انتخابی (Watchlist) را اسکن می‌کند تا بهترین فرصت معاملاتی را پیدا کند.</p>
          </div>
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>اگر پوزیشنی باز باشد، هوش مصنوعی هر چند دقیقه یکبار نمودار را بررسی می‌کند تا در صورت نیاز حد ضرر را جابجا کند یا دستور فروش صادر کند.</p>
          </div>
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>در صورت رسیدن به حد ضرر روزانه (Max Drawdown)، ربات برای جلوگیری از ضرر بیشتر به صورت خودکار متوقف می‌شود.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategyInfo;
