export var memory = [];

export function resetMemory() {
    memory = [];
}

export function saveMemory(elementName, data, ri, ci) {
    let smIdx = memory.findIndex(e => e[0] === elementName);
    let sm;
    if (smIdx > -1) {
        sm = memory[smIdx];
    } else {
        sm = [elementName, []];
        memory.push(sm);
    }
    let sd = sm[1];
    let rd = sd[ri] || [];
    rd[ci] = data;
    sd[ri] = rd;
}

export function getDataInMemory(elementName, ri, ci) {
    let sm = memory.find(e => e[0] === elementName) || [];
    if (sm) {
        let m = sm[1];
        if (m && m[ri] && m[ri][ci] && m[ri][ci].expressID) {
            return m[ri][ci];
        } else {
            return false;
        }
    }
    return false;
}
