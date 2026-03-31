
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
          <span>استراتژی تأیید سه‌گانه (Triple Confirmation)</span>
        </h3>
        <p className="text-sm leading-relaxed mb-4 text-slate-400" dir="rtl">
          این ربات از یک سیستم تأیید هوشمند برای شناسایی تریدهای سودآور در تایم‌فریم ۱۵ دقیقه استفاده می‌کند. استراتژی جدید برای تعادل بین تهاجم و صبر بهینه‌سازی شده تا تریدهای بیشتری با سود بالای ۱.۵٪ انجام دهد.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
            <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2 flex items-center space-x-2">
              <i className="fas fa-search-dollar text-[10px]"></i>
              <span>سه مرحله تأیید</span>
            </h4>
            <ul className="text-[11px] space-y-2 text-slate-400 list-disc list-inside" dir="rtl">
              <li>**تشخیص روند (EMA 200):** ترید فقط در جهت روند اصلی بازار.</li>
              <li>**قدرت بازار (RSI):** اطمینان از اینکه بازار بیش از حد اشباع نشده باشد.</li>
              <li>**تأیید هوش مصنوعی (SMC):** شناسایی ردپای بانک‌ها (Order Blocks) توسط Gemini.</li>
            </ul>
          </div>
          
          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
            <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center space-x-2">
              <i className="fas fa-clock text-[10px]"></i>
              <span>هوش زمانی (Sessions)</span>
            </h4>
            <ul className="text-[11px] space-y-2 text-slate-400 list-disc list-inside" dir="rtl">
              <li>**سشن لندن:** تمرکز روی پوند و طلا (۰۸:۰۰ تا ۱۶:۳۰ UTC).</li>
              <li>**سشن نیویورک:** اوج نوسانات نفت و طلا (۱۳:۰۰ تا ۲۱:۰۰ UTC).</li>
              <li>**زمان طلایی:** همپوشانی لندن و نیویورک برای بیشترین سود.</li>
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
          <p className="text-[9px] text-slate-500 uppercase font-bold">Gemini 3.1 Flash</p>
        </div>
        
        <div className="bg-[#080812] border border-white/5 p-5 rounded-3xl text-center">
          <div className="w-10 h-10 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className="fas fa-bullseye"></i>
          </div>
          <h5 className="text-[10px] font-black text-white uppercase mb-1">هدف سود روزانه</h5>
          <p className="text-[9px] text-slate-500 uppercase font-bold">2% to 5% Daily Target</p>
        </div>

        <div className="bg-[#080812] border border-white/5 p-5 rounded-3xl text-center">
          <div className="w-10 h-10 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className="fas fa-shield-virus"></i>
          </div>
          <h5 className="text-[10px] font-black text-white uppercase mb-1">مدیریت ریسک</h5>
          <p className="text-[9px] text-slate-500 uppercase font-bold">Automatic SL/TP</p>
        </div>
      </section>

      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6">
        <h4 className="text-sm font-black text-white mb-4 flex items-center space-x-2">
          <i className="fas fa-info-circle text-indigo-500"></i>
          <span>ربات دقیقاً چه کار می‌کند؟</span>
        </h4>
        <div className="space-y-4 text-[11px] text-slate-400 leading-relaxed" dir="rtl">
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>**رصد مداوم:** هر ۱۲۰ ثانیه چارت ۱۵ دقیقه‌ای ارزهای برتر بازار را اسکن می‌کند.</p>
          </div>
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>**تحلیل هوشمند:** اندیکاتورهای RSI و EMA را محاسبه کرده و برای تأیید نهایی به هوش مصنوعی Gemini می‌فرستد.</p>
          </div>
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>**ورود هدفمند:** فقط زمانی وارد ترید می‌شود که اطمینان بالای ۷۵٪ داشته باشد و سود پیش‌بینی شده بالای ۱.۵٪ باشد تا سود خالص قابل لمس باشد.</p>
          </div>
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0"></div>
            <p>**حفظ سود:** به محض رسیدن به هدف سود روزانه یا حد ضرر روزانه، فعالیتش را برای حفظ سرمایه متوقف می‌کند.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategyInfo;
