def inn10(p9):
    w=[2,4,10,3,5,9,4,6,8]; d=[int(c) for c in p9]; return p9+str(sum(a*b for a,b in zip(w,d))%11%10)
def inn12(p10):
    d=[int(c) for c in p10]
    w1=[7,2,4,10,3,5,9,4,6,8]; c1=sum(a*b for a,b in zip(w1,d))%11%10; d.append(c1)
    w2=[3,7,2,4,10,3,5,9,4,6,8]; c2=sum(a*b for a,b in zip(w2,d))%11%10
    return p10+str(c1)+str(c2)
def snils(p9):
    s=sum(int(c)*(9-i) for i,c in enumerate(p9)); 
    s = s if s<100 else (0 if s in (100,101) else s%101); s = 0 if s in (100,101) else s
    return p9+'%02d'%s
print(inn10('027406211'), inn12('0274098765'), inn10('772816897'), snils('045123678'), inn12('7701987654'))
