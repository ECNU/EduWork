"""Original, reproducible instrumental cues. No recordings, samples or model API.

AI-assisted score and DSP code; deterministic synthesis. The project's MIT
license applies to our contributions to the extent rights exist. No assertion
that AI-generated material is automatically public domain or infringement-free.
"""
from pathlib import Path
import hashlib
import json
import math
import wave
import argparse
import numpy as np

ROOT = Path(__file__).resolve().parent
RATE = 32000
TRACKS = [
    dict(id="quiet-explanation", title="清晰思路 · 安静讲解", category="讲解 / 课程", bpm=80, key="D major", roots=[50,47,55,57], mode="soft", melody=[9,7,4,2,4,7,11,9]),
    dict(id="warm-campus", title="午后校园 · 温暖舒展", category="校园 / 人文", bpm=92, key="C major", roots=[48,53,45,55], mode="warm", melody=[4,7,9,7,2,4,0,2]),
    dict(id="digital-pulse", title="数据微光 · 科技脉动", category="科技 / 产品", bpm=112, key="A minor", roots=[45,41,48,43], mode="pulse", melody=[0,7,10,12,7,3,5,7]),
    dict(id="bright-day", title="轻快日常 · 明亮节奏", category="活动 / 日常", bpm=104, key="G major", roots=[43,48,40,50], mode="bright", melody=[7,9,4,2,7,11,9,4]),
    dict(id="reading-room", title="静读时光 · 舒缓氛围", category="阅读 / 专注", bpm=64, key="F major", roots=[41,46,43,48], mode="ambient", melody=[0,7,9,4,2,7,4,0]),
    dict(id="steady-story", title="行进的故事 · 纪录叙事", category="纪实 / 汇报", bpm=88, key="D minor", roots=[38,46,41,45], mode="story", melody=[0,3,7,10,9,7,5,3]),
]

def hz(note):
    return 440 * 2 ** ((note-69)/12)

def synth(note, seconds, timbre):
    t = np.arange(int(seconds*RATE), dtype=np.float64)/RATE
    f = hz(note)
    if timbre == "pad":
        value = (np.sin(2*np.pi*f*t) + .23*np.sin(2*np.pi*f*1.003*t) + .16*np.sin(2*np.pi*f*2*t))/1.39
        env = np.minimum(t/.24,1)*np.minimum((seconds-t)/.5,1)
    elif timbre == "bass":
        value = np.sin(2*np.pi*f*t)+.15*np.sin(2*np.pi*2*f*t)
        env = np.minimum(t/.018,1)*np.exp(-t/1.1)*np.minimum((seconds-t)/.06,1)
    else:
        # Bell/soft electric keys, all partials below Nyquist.
        value = np.sin(2*np.pi*f*t)+.24*np.sin(2*np.pi*2*f*t)*np.exp(-t*3)+.07*np.sin(2*np.pi*3*f*t)*np.exp(-t*5)
        env = np.minimum(t/.007,1)*np.exp(-t/(.75 if timbre=="pluck" else 1.65))*np.minimum((seconds-t)/.05,1)
    return value*np.maximum(env,0)

def compose(spec):
    beat = 60/spec['bpm']; bars=16; duration=bars*4*beat
    count=round(duration*RATE); mix=np.zeros((count,2)); rng=np.random.default_rng(7100+spec['bpm'])
    events=[]
    def add(samples,start,amp,pan=0):
        # Wrap release tails into the beginning for a continuous loop.
        indices=(np.arange(len(samples))+round(start*RATE))%count
        np.add.at(mix[:,0],indices,samples*amp*math.sqrt((1-pan)/2))
        np.add.at(mix[:,1],indices,samples*amp*math.sqrt((1+pan)/2))
    def note(pitch,start,length,amp,timbre,pan=0):
        events.append(dict(pitch=pitch,beat=round(start/beat,4),length=round(length/beat,4),instrument=timbre,amplitude=amp,pan=pan))
        add(synth(pitch,length,timbre),start,amp,pan)
    minor = spec['mode'] in ['pulse','story']
    for bar in range(bars):
        root=spec['roots'][bar%4]; start=bar*4*beat
        third=3 if (minor and bar%4==0) or (not minor and bar%4==2) else 4
        chord=[root+12,root+12+third,root+19,root+26]
        for i,pitch in enumerate(chord):
            note(pitch,start,4*beat+.45,.043 if spec['mode']!='ambient' else .065,'pad',(i-1.5)/3)
        if spec['mode'] not in ['ambient']:
            for step in [0,2]:note(root,start+step*beat,1.6*beat,.12,'bass',0)
        steps=[0,1.5,2.5] if spec['mode'] in ['soft','ambient'] else [0,.5,1.5,2,3,3.5]
        for j,step in enumerate(steps):
            pitch=chord[(j+bar)%4]+(12 if j%3==1 else 0)
            note(pitch,start+step*beat,1.6*beat,.055 if spec['mode']=='ambient' else .072,'keys',(-1 if j%2 else 1)*.36)
        # A sparse original motif, with a changed ending in each 8-bar phrase.
        if bar%2==0:
            motif=spec['melody']; tonic=spec['roots'][0]+24
            for j,step in enumerate([.5,2.5]):
                pitch=tonic+motif[(bar+j+(4 if bar>=8 else 0))%8]
                note(pitch,start+step*beat,2.1*beat,.065,'keys',.12)
        if spec['mode'] in ['pulse','bright','warm','story']:
            for step in [0,2]:
                t=np.arange(int(.24*RATE))/RATE
                kick=np.sin(2*np.pi*(48*t+42*(1-np.exp(-t*24))/24))*np.exp(-t*22)*np.minimum(t/.004,1)
                add(kick,start+step*beat,.15)
            for step in [1,3]:
                t=np.arange(int(.12*RATE))/RATE
                noise=rng.normal(0,.4,len(t));noise=np.r_[0,np.diff(noise)]
                add(noise*np.exp(-t*45)*np.minimum(t/.003,1),start+step*beat,.07,-.18)
            for step in np.arange(.5,4,.5):
                t=np.arange(int(.045*RATE))/RATE
                noise=rng.normal(0,.35,len(t));noise=np.r_[0,np.diff(noise)]
                add(noise*np.exp(-t*100)*np.minimum(t/.002,1),start+step*beat,.022,.3)
    # A small stereo delay; cyclic to preserve the loop seam.
    mix += .12*np.roll(mix[:,::-1],round(beat*.75*RATE),axis=0)
    mix -= mix.mean(axis=0)
    rms=np.sqrt(np.mean(mix**2)); mix*=min(.12/max(rms,1e-9),.78/max(np.max(np.abs(mix)),1e-9))
    # Remove the residual sample discontinuity without a long silence at the join.
    blend=min(320,len(mix)//10); delta=mix[-1]-mix[0]
    mix[-blend:]-=np.linspace(0,1,blend)[:,None]*delta
    pcm=np.clip(np.round(mix*32767),-32768,32767).astype('<i2')
    target=ROOT/'bgm';target.mkdir(exist_ok=True)
    file=target/(spec['id']+'.wav')
    with wave.open(str(file),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(RATE);out.writeframes(pcm.tobytes())
    score=ROOT/'scores';score.mkdir(exist_ok=True)
    (score/(spec['id']+'.json')).write_text(json.dumps({'version':1,**spec,'bars':bars,'events':events},ensure_ascii=False,indent=2),encoding='utf8')
    return {**spec,'filename':file.name,'author':'Knowledge Studio contributors (AI-assisted composition)',
        'license':'MIT — project-generated material; see BGM usage notes','source':'../compose_bgm.py and ../scores/'+spec['id']+'.json',
        'generation':'AI-assisted score and deterministic local additive/FM-style synthesis; no third-party audio samples',
        'durationSeconds':count/RATE,'loop':True,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),
        'validation':{'sampleRate':RATE,'channels':2,'peak':round(float(np.max(np.abs(mix))),6),'rmsDbFS':round(float(20*np.log10(np.sqrt(np.mean(mix**2)))),2),'clippedSamples':int(np.count_nonzero(np.abs(pcm.astype(np.int32))>=32767))}}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Render reproducible PCM masters outside the release directory.')
    parser.add_argument('--output',required=True,type=Path,help='Output directory for bgm/ and scores/ (use an ignored build directory)')
    args=parser.parse_args()
    ROOT=args.output.resolve()
    ROOT.mkdir(parents=True,exist_ok=True)
    tracks=[compose(spec) for spec in TRACKS]
    (ROOT/'bgm/catalog.json').write_text(json.dumps({'schemaVersion':1,'policy':{'requirePerTrackLicenseMetadata':True,'requireSha256':True,'allowUnknownOrUnverifiedMusic':False},'tracks':tracks},ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps([{'id':t['id'],'seconds':t['durationSeconds'],**t['validation']} for t in tracks],ensure_ascii=False,indent=2))
