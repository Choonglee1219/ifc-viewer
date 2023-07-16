import { Mesh } from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils";
import * as _ from "lodash";

export function mergeByMaterial(meshes) {
    const meshStore = [];
    let materialMap = {};
    let groupByMat = _.groupBy(meshes, m => {
        if (!materialMap[m.material.name]) materialMap[m.material.name] = m.material;
        return m.material.name;
    });
    for (let matName in groupByMat) {
        let material = materialMap[matName];
        let meshes = groupByMat[matName];
        let geos = meshes.map(m => m.geometry);
        let mergedGeo = BufferGeometryUtils.mergeGeometries(geos);
        let mesh = new Mesh(mergedGeo, material);
        meshStore.push(mesh);
    }
    return meshStore;
}
